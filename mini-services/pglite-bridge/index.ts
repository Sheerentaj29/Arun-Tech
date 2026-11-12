/**
 * Postgres wire-protocol bridge for PGlite (EXTENDED PROTOCOL SUPPORT).
 *
 * Implements the full Postgres wire protocol including the extended query
 * messages (Parse, Bind, Describe, Execute, Sync, Close) that Prisma uses.
 *
 * Run with: bun --hot mini-services/pglite-bridge/index.ts
 */

import { PGlite } from "@electric-sql/pglite";
import { createServer } from "net";

const PORT = 5433;
const DATA_DIR = "/home/z/my-project/db/staging-pg";

async function main() {
  console.log(`[bridge] Opening PGlite from ${DATA_DIR}...`);
  const pg = new PGlite(DATA_DIR);
  const v = await pg.query("SELECT version();");
  console.log(`[bridge] PGlite ready: ${v.rows[0]?.version?.slice(0, 60)}`);

  const server = createServer((socket) => {
    let authenticated = false;
    let buffer = Buffer.alloc(0);

    // Extended protocol state
    const statements = new Map<string, { sql: string; paramTypes: number[] }>();
    const portals = new Map<string, { stmtName: string; params: any[]; resultFormats: number[] }>();
    let stmtCounter = 0;
    let portalCounter = 0;

    function sendBuf(buf: Buffer) {
      socket.write(buf);
    }

    function makeMsg(type: number, body: Buffer): Buffer {
      const hdr = Buffer.alloc(5);
      hdr.writeInt8(type, 0);
      hdr.writeInt32BE(4 + body.length, 1);
      return Buffer.concat([hdr, body]);
    }

    function sendAuthenticationOk() {
      sendBuf(makeMsg(0x52, Buffer.alloc(4).fill(0, 0, 4))); // auth method 0 = OK
    }

    function sendParameterStatus(key: string, val: string) {
      sendBuf(makeMsg(0x53, Buffer.from(`${key}\0${val}\0`, "utf8")));
    }

    function sendReadyForQuery(status: number = 0x49) {
      sendBuf(makeMsg(0x5A, Buffer.from([status])));
    }

    function sendErrorResponse(msg: string) {
      const body = Buffer.concat([
        Buffer.from("SERROR\0", "utf8"),
        Buffer.from("CXX000\0", "utf8"),
        Buffer.from("M" + msg + "\0", "utf8"),
        Buffer.from([0]),
      ]);
      sendBuf(makeMsg(0x45, body));
    }

    function sendCommandComplete(tag: string) {
      sendBuf(makeMsg(0x43, Buffer.from(tag + "\0", "utf8")));
    }

    function sendRowDescription(fields: any[]) {
      if (!fields || fields.length === 0) return;
      const numFields = Buffer.alloc(2);
      numFields.writeInt16BE(fields.length, 0);
      const fieldBufs: Buffer[] = [numFields];
      for (const f of fields) {
        const nameBuf = Buffer.from(f.name + "\0", "utf8");
        const info = Buffer.alloc(18);
        info.writeInt32BE(0, 0); // table OID
        info.writeInt16BE(0, 4); // column attr number
        info.writeInt32BE(f.dataTypeID ?? 25, 6); // type OID (25 = text)
        info.writeInt16BE(f.dataTypeSize ?? -1, 10); // type size
        info.writeInt32BE(-1, 12); // type modifier
        info.writeInt16BE(0, 16); // format code (0 = text)
        fieldBufs.push(Buffer.concat([nameBuf, info]));
      }
      sendBuf(makeMsg(0x54, Buffer.concat(fieldBufs)));
    }

    function sendDataRows(rows: any[], fields: any[]) {
      if (!rows || rows.length === 0) return;
      for (const row of rows) {
        const colCount = fields.length;
        const colBufs: Buffer[] = [Buffer.from([colCount & 0xFF, (colCount >> 8) & 0xFF])];
        for (const f of fields) {
          const val = row[f.name];
          if (val === null || val === undefined) {
            const nullBuf = Buffer.alloc(4);
            nullBuf.writeInt32BE(-1, 0);
            colBufs.push(nullBuf);
          } else {
            const valStr = val instanceof Date ? val.toISOString()
              : typeof val === "boolean" ? (val ? "t" : "f")
              : typeof val === "object" ? JSON.stringify(val)
              : String(val);
            const valBuf = Buffer.from(valStr, "utf8");
            const lenBuf = Buffer.alloc(4);
            lenBuf.writeInt32BE(valBuf.length, 0);
            colBufs.push(Buffer.concat([lenBuf, valBuf]));
          }
        }
        sendBuf(makeMsg(0x44, Buffer.concat(colBufs)));
      }
    }

    async function handleQuery(queryText: string) {
      try {
        const result = await pg.query(queryText);
        if (result.fields && result.fields.length > 0) {
          sendRowDescription(result.fields);
          sendDataRows(result.rows, result.fields);
          sendCommandComplete(`SELECT ${result.rows?.length ?? 0}`);
        } else {
          const upper = queryText.trim().toUpperCase();
          if (upper.startsWith("INSERT")) sendCommandComplete("INSERT 0 " + (result.affectedCount ?? 0));
          else if (upper.startsWith("UPDATE")) sendCommandComplete("UPDATE " + (result.affectedCount ?? 0));
          else if (upper.startsWith("DELETE")) sendCommandComplete("DELETE " + (result.affectedCount ?? 0));
          else sendCommandComplete("OK");
        }
      } catch (err: any) {
        sendErrorResponse(err.message);
      }
    }

    async function handleExtendedQuery(msgType: number, body: Buffer) {
      try {
        switch (msgType) {
          case 0x50: { // Parse (P)
            // Format: statement_name\0 query\0 num_params (int16) [param_type_oid (int32)...]
            const stmtNameEnd = body.indexOf(0);
            const stmtName = body.slice(0, stmtNameEnd).toString("utf8") || `stmt_${++stmtCounter}`;
            const queryEnd = body.indexOf(0, stmtNameEnd + 1);
            const sql = body.slice(stmtNameEnd + 1, queryEnd).toString("utf8");
            const numParams = body.readInt16BE(queryEnd + 1);
            const paramTypes: number[] = [];
            for (let i = 0; i < numParams; i++) {
              paramTypes.push(body.readInt32BE(queryEnd + 3 + i * 4));
            }
            statements.set(stmtName, { sql, paramTypes });
            sendBuf(makeMsg(0x31, Buffer.from(stmtName + "\0", "utf8"))); // ParseComplete (1)
            break;
          }
          case 0x42: { // Bind (B)
            // Format: portal_name\0 stmt_name\0 num_param_formats(int16) [format(int16)...] num_params(int16) [param_len(int32) param_val...] num_result_formats(int16) [format(int16)...]
            let off = 0;
            const portalNameEnd = body.indexOf(0, off);
            const portalName = body.slice(off, portalNameEnd).toString("utf8") || `portal_${++portalCounter}`;
            off = portalNameEnd + 1;
            const stmtNameEnd = body.indexOf(0, off);
            const stmtName = body.slice(off, stmtNameEnd).toString("utf8");
            off = stmtNameEnd + 1;
            const numParamFormats = body.readInt16BE(off); off += 2;
            const paramFormats: number[] = [];
            for (let i = 0; i < numParamFormats; i++) { paramFormats.push(body.readInt16BE(off)); off += 2; }
            const numParams = body.readInt16BE(off); off += 2;
            const params: any[] = [];
            for (let i = 0; i < numParams; i++) {
              const paramLen = body.readInt32BE(off); off += 4;
              if (paramLen === -1) { params.push(null); continue; }
              const paramVal = body.slice(off, off + paramLen);
              off += paramLen;
              // Assume text format (format code 0) — convert to string
              params.push(paramVal.toString("utf8"));
            }
            const numResultFormats = body.readInt16BE(off); off += 2;
            const resultFormats: number[] = [];
            for (let i = 0; i < numResultFormats; i++) { resultFormats.push(body.readInt16BE(off)); off += 2; }
            portals.set(portalName, { stmtName, params, resultFormats });
            sendBuf(makeMsg(0x32, Buffer.alloc(0))); // BindComplete (2)
            break;
          }
          case 0x44: { // Describe (D)
            const descType = body.readInt8(0);
            const nameEnd = body.indexOf(0, 1);
            const name = body.slice(1, nameEnd).toString("utf8");
            if (descType === 0x53) { // Statement (S)
              const stmt = statements.get(name);
              if (stmt) {
                // Send ParameterDescription
                const numParams = stmt.paramTypes.length;
                const paramDesc = Buffer.alloc(4 + numParams * 4);
                paramDesc.writeInt16BE(numParams, 0);
                for (let i = 0; i < numParams; i++) {
                  paramDesc.writeInt32BE(stmt.paramTypes[i] || 0, 2 + i * 4);
                }
                sendBuf(makeMsg(0x74, paramDesc)); // ParameterDescription (t)
                // We don't know the result columns without executing — send NoData
                sendBuf(makeMsg(0x6E, Buffer.alloc(0))); // NoData (n)
              }
            } else if (descType === 0x50) { // Portal (P)
              // We don't know columns yet — will send after execution
            }
            break;
          }
          case 0x45: { // Execute (E)
            const portalNameEnd = body.indexOf(0, 0);
            const portalName = body.slice(0, portalNameEnd).toString("utf8");
            const maxRows = body.readInt32BE(portalNameEnd + 1);
            const portal = portals.get(portalName);
            if (portal) {
              const stmt = statements.get(portal.stmtName);
              if (stmt) {
                try {
                  const result = await pg.query(stmt.sql, portal.params);
                  if (result.fields && result.fields.length > 0) {
                    sendRowDescription(result.fields);
                    sendDataRows(result.rows, result.fields);
                  }
                  sendCommandComplete(`SELECT ${result.rows?.length ?? 0}`);
                } catch (err: any) {
                  sendErrorResponse(err.message);
                }
              }
            }
            break;
          }
          case 0x53: { // Sync (S) — no body
            sendReadyForQuery();
            break;
          }
          case 0x43: { // Close (C)
            const closeType = body.readInt8(0);
            const nameEnd = body.indexOf(0, 1);
            const name = body.slice(1, nameEnd).toString("utf8");
            if (closeType === 0x53) statements.delete(name);
            else if (closeType === 0x50) portals.delete(name);
            sendBuf(makeMsg(0x33, Buffer.alloc(0))); // CloseComplete (3)
            break;
          }
          case 0x46: { // Flush (F) — flush output buffer, no ReadyForQuery
            break;
          }
          default:
            // Unknown extended message — ignore
            break;
        }
      } catch (err: any) {
        sendErrorResponse(err.message);
      }
    }

    socket.on("data", async (data) => {
      buffer = Buffer.concat([buffer, data]);

      while (buffer.length > 0) {
        if (!authenticated) {
          if (buffer.length < 4) break;
          const len = buffer.readInt32BE(0);
          if (buffer.length < len) break;
          const msg = buffer.slice(4, len);
          buffer = buffer.slice(len);
          const protoVersion = msg.readInt32BE(0);

          if (protoVersion === 80877103) { // SSL request
            socket.write(Buffer.from("N", "ascii"));
            continue;
          }
          if (protoVersion === 80877102) { socket.end(); return; } // Cancel

          // Parse startup parameters
          let off = 4;
          while (off < msg.length - 1) {
            const keyEnd = msg.indexOf(0, off);
            if (keyEnd === -1 || keyEnd === off) break;
            const key = msg.slice(off, keyEnd).toString("utf8");
            const valEnd = msg.indexOf(0, keyEnd + 1);
            if (valEnd === -1) break;
            off = valEnd + 1;
          }

          sendAuthenticationOk();
          sendParameterStatus("server_version", "16.4");
          sendParameterStatus("server_encoding", "UTF8");
          sendParameterStatus("client_encoding", "UTF8");
          sendParameterStatus("DateStyle", "ISO, MDY");
          sendParameterStatus("integer_datetimes", "on");
          sendParameterStatus("standard_conforming_strings", "on");
          sendParameterStatus("TimeZone", "UTC");
          sendReadyForQuery();
          authenticated = true;
        } else {
          if (buffer.length < 5) break;
          const msgType = buffer.readInt8(0);
          const msgLen = buffer.readInt32BE(1);
          if (buffer.length < 1 + msgLen) break;
          const msgBody = buffer.slice(5, 1 + msgLen);
          buffer = buffer.slice(1 + msgLen);

          if (msgType === 0x51) { // Simple Query (Q)
            const queryText = msgBody.slice(0, -1).toString("utf8");
            await handleQuery(queryText);
            sendReadyForQuery();
          } else if (msgType === 0x58) { // Terminate (X)
            socket.end();
            return;
          } else if (msgType === 0x53 && msgLen === 4) { // Sync (S) — no body
            sendReadyForQuery();
          } else {
            // Extended protocol messages: Parse, Bind, Describe, Execute, Close, Flush
            await handleExtendedQuery(msgType, msgBody);
          }
        }
      }
    });

    socket.on("error", (err) => {
      console.error("[bridge] Socket error:", err.message);
    });
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[bridge] Postgres wire-protocol server on port ${PORT}`);
    console.log(`[bridge] DATABASE_URL=postgresql://localhost:${PORT}/inspection_reports`);
  });

  process.on("SIGTERM", () => { server.close(); process.exit(0); });
  process.on("SIGINT", () => { server.close(); process.exit(0); });
}

main().catch((e) => {
  console.error("[bridge] FATAL:", e);
  process.exit(1);
});
