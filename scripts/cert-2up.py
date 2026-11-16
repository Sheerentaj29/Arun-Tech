"""Certificate layout: max 2 certificates per page, stacked vertically
(upper half / lower half) with clear spacing, aspect ratio preserved via
pdfkit's `fit`, applied independently to Equipment and Personnel sections.
Section headings and TOC numbering preserved."""
P = "/home/z/my-project/src/lib/pdf/pipeline-report.ts"
s = open(P).read()

START = "  if (certificates.length > 0) {"
END = "    y = pageMaxY;\n  }"
assert s.count(START) == 1 and s.count(END) == 1
i0 = s.index(START)
i1 = s.index(END, i0) + len(END)
old_block = s[i0:i1]
# sanity: the old block is the certificate section
assert "renderCertificateOnPage" in old_block and "equipCerts" in old_block

NEW = '''  if (certificates.length > 0) {
    const equipCerts = certificates.filter((c) => c.category === "EQUIPMENT");
    const personnelCerts = certificates.filter((c) => c.category === "PERSONNEL");
    const certBranchRef: { current: ReturnType<typeof makeTocBranch> | null } = { current: null };

    // ═══════════════════════════════════════════════════════════════
    // Certificate page layout: up to TWO certificates per page,
    // stacked vertically — first certificate in the upper half,
    // second in the lower half, with a clear gap between them.
    //   1 certificate  → full page
    //   2 certificates → one page (upper + lower)
    //   3 certificates → 2 + 1      4 → 2 + 2      5 → 2 + 2 + 1 …
    // Applied INDEPENDENTLY to Equipment and Personnel sections
    // (their certificates never share a page).
    // Aspect ratio is always preserved — pdfkit's `fit` scales the
    // image proportionally inside the slot (never stretches/crops).
    // Multi-page PDF certificates: page 1 occupies the slot, remaining
    // pages continue on their own full-area pages (with caption), and
    // the paired certificate then starts on a fresh page.
    // ═══════════════════════════════════════════════════════════════
    const CERT_CAPTION_H = 34; // title (11pt bold) + file name (8pt) + gaps
    const CERT_GAP = 24;       // vertical gap between the two certificates

    // Draw ONE certificate inside a rectangular slot (caption above the
    // image). Returns the number of extra pages a multi-page PDF
    // certificate produced (those were drawn on their own pages).
    const drawCertificateInSlot = async (
      cert: typeof certificates[0],
      slotX: number,
      slotY: number,
      slotW: number,
      slotH: number,
    ): Promise<number> => {
      // Caption: certificate title + uploaded file name
      doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
      doc.text(cert.title || "Certificate", slotX, slotY, { width: slotW, align: "center" });
      doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
      doc.text(`File: ${cert.fileName}`, slotX, slotY + 16, { width: slotW, align: "center" });
      doc.fillColor("#000");

      const imgY = slotY + CERT_CAPTION_H;
      const imgH = Math.max(40, slotH - CERT_CAPTION_H);
      // Light border around the certificate's image area
      doc.rect(slotX, imgY, slotW, imgH).stroke("#ddd");

      if (!cert.filePath || !existsSync(cert.filePath)) {
        doc.font(FONT_REGULAR).fontSize(9).fillColor("#999");
        doc.text(`[File missing: ${cert.fileName}]`, slotX, imgY + imgH / 2, { width: slotW, align: "center" });
        doc.fillColor("#000");
        return 0;
      }

      const ext = (cert.fileExtension || "").toLowerCase();
      if (ext === ".pdf") {
        // Rasterize each page of the PDF certificate
        const pageBuffers = await rasterizePdfPages(cert.filePath);
        if (pageBuffers.length === 0) {
          doc.fillColor("#999").fontSize(9).font(FONT_REGULAR);
          doc.text("[Could not rasterize PDF certificate]", slotX, imgY + imgH / 2, { width: slotW, align: "center" });
          doc.fillColor("#000");
          return 0;
        }
        // Page 1 of the PDF certificate goes into the slot
        try {
          doc.image(pageBuffers[0], slotX, imgY, { fit: [slotW, imgH], align: "center", valign: "center" });
        } catch {}
        // Remaining pages of the SAME PDF certificate: full-area pages
        for (let p = 1; p < pageBuffers.length; p++) {
          addNewPage();
          doc.font(FONT_BOLD).fontSize(11).fillColor("#000");
          doc.text(cert.title || "Certificate", MARGIN, MARGIN, { width: usableW, align: "center" });
          doc.font(FONT_REGULAR).fontSize(8).fillColor("#444");
          doc.text(`File: ${cert.fileName}  |  Page ${p + 1} of ${pageBuffers.length}`, MARGIN, MARGIN + 16, { width: usableW, align: "center" });
          doc.fillColor("#000");
          const fullY = MARGIN + CERT_CAPTION_H;
          const fullH = pageMaxY - fullY;
          doc.rect(MARGIN, fullY, usableW, fullH).stroke("#ddd");
          try {
            doc.image(pageBuffers[p], MARGIN, fullY, { fit: [usableW, fullH], align: "center", valign: "center" });
          } catch {}
        }
        return pageBuffers.length - 1;
      }
      if ([".png", ".jpg", ".jpeg"].includes(ext)) {
        try {
          const imgBuf = await loadEmbeddableImage(cert.filePath);
          if (!imgBuf) throw new Error("unreadable image");
          doc.image(imgBuf, slotX, imgY, { fit: [slotW, imgH], align: "center", valign: "center" });
        } catch {
          doc.fillColor("#999").fontSize(9).font(FONT_REGULAR);
          doc.text("[Could not embed image]", slotX, imgY + imgH / 2, { width: slotW, align: "center" });
          doc.fillColor("#000");
        }
        return 0;
      }
      return 0;
    };

    // Render one certificate SECTION in chunks of two per page.
    // `firstPageTop` = Y where the first pair starts (below the section
    // heading); continuation pages start at MARGIN.
    const renderCertSection = async (
      certs: typeof certificates,
      firstPageTop: number,
    ) => {
      for (let start = 0; start < certs.length; start += 2) {
        addNewPage();
        const top = start === 0 ? firstPageTop : MARGIN;
        const availH = pageMaxY - top;
        const pair = certs.slice(start, start + 2);
        const twoUp = pair.length === 2;
        // 1 certificate → whole available area; 2 → two stacked halves
        const slotH = twoUp ? Math.floor((availH - CERT_GAP) / 2) : availH;

        // First certificate of the pair (upper half)
        const extraPages = await drawCertificateInSlot(pair[0], MARGIN, top, usableW, slotH);
        if (!twoUp) continue;

        if (extraPages > 0) {
          // The first certificate's extra PDF pages consumed the rest of
          // this page — the second certificate starts on a fresh page.
          addNewPage();
          await drawCertificateInSlot(pair[1], MARGIN, MARGIN, usableW, pageMaxY - MARGIN);
        } else {
          // Second certificate (lower half)
          const slot2Y = top + slotH + CERT_GAP;
          await drawCertificateInSlot(pair[1], MARGIN, slot2Y, usableW, slotH);
        }
      }
    };

    // ── Instrument / Equipment Certificates ──
    if (equipCerts.length > 0) {
      // Section page: "Certification" main heading + "Instrument
      // Calibration" sub-heading, with the FIRST TWO certificates below.
      addNewPage();
      if (certBranchRef.current === null) {
        certBranchRef.current = makeTocBranch("Certification");
      }
      const certBranch = certBranchRef.current;
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_MAIN).fillColor("#000");
      doc.text(`${certBranch.main()}. Certification`, MARGIN, MARGIN, { width: usableW });
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB);
      doc.text(`${certBranch.sub("Instrument Calibration")} Instrument Calibration (${equipCerts.length})`, MARGIN, MARGIN + 26, { width: usableW });

      // The section page already has its heading drawn — start the first
      // pair below it. Instead of letting renderCertSection call
      // addNewPage() again (which would leave this heading page blank),
      // render the chunks manually here:
      {
        const firstTop = MARGIN + 66; // below the two headings
        const availH = pageMaxY - firstTop;
        const firstPair = equipCerts.slice(0, 2);
        const twoUp = firstPair.length === 2;
        const slotH = twoUp ? Math.floor((availH - CERT_GAP) / 2) : availH;
        const extraPages = await drawCertificateInSlot(firstPair[0], MARGIN, firstTop, usableW, slotH);
        if (twoUp) {
          if (extraPages > 0) {
            addNewPage();
            await drawCertificateInSlot(firstPair[1], MARGIN, MARGIN, usableW, pageMaxY - MARGIN);
          } else {
            const slot2Y = firstTop + slotH + CERT_GAP;
            await drawCertificateInSlot(firstPair[1], MARGIN, slot2Y, usableW, slotH);
          }
        }
        // Remaining certificates: 2 per page from index 2
        if (equipCerts.length > 2) {
          await renderCertSection(equipCerts.slice(2), MARGIN);
        }
      }
    }

    // ── Inspector / Personnel Certificates ──
    // NDT Level 3 first, then NDT Level 2, then any other personnel certs.
    const ndtLevel3Certs = personnelCerts.filter((c) => (c.title || "").includes("NDT Level 3"));
    const ndtLevel2Certs = personnelCerts.filter((c) => (c.title || "").includes("NDT Level 2"));
    const otherPersonnelCerts = personnelCerts.filter((c) => !ndtLevel3Certs.includes(c) && !ndtLevel2Certs.includes(c));
    const orderedPersonnelCerts = [...ndtLevel3Certs, ...ndtLevel2Certs, ...otherPersonnelCerts];

    if (orderedPersonnelCerts.length > 0) {
      // Section page: "Inspector Certificates" sub-heading + first pair
      addNewPage();
      if (certBranchRef.current === null) {
        certBranchRef.current = makeTocBranch("Certification");
      }
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SUB).fillColor("#000");
      doc.text(`${certBranchRef.current.sub("Inspector Certificates")} Inspector Certificates (${orderedPersonnelCerts.length})`, MARGIN, MARGIN, { width: usableW });

      {
        const firstTop = MARGIN + 50; // below the sub-heading
        const availH = pageMaxY - firstTop;
        const firstPair = orderedPersonnelCerts.slice(0, 2);
        const twoUp = firstPair.length === 2;
        const slotH = twoUp ? Math.floor((availH - CERT_GAP) / 2) : availH;
        const extraPages = await drawCertificateInSlot(firstPair[0], MARGIN, firstTop, usableW, slotH);
        if (twoUp) {
          if (extraPages > 0) {
            addNewPage();
            await drawCertificateInSlot(firstPair[1], MARGIN, MARGIN, usableW, pageMaxY - MARGIN);
          } else {
            const slot2Y = firstTop + slotH + CERT_GAP;
            await drawCertificateInSlot(firstPair[1], MARGIN, slot2Y, usableW, slotH);
          }
        }
        if (orderedPersonnelCerts.length > 2) {
          await renderCertSection(orderedPersonnelCerts.slice(2), MARGIN);
        }
      }
    }

    // After certificates, set y to pageMaxY so the override note (if any)
    // starts on a new page rather than overlapping with the last certificate.
    // NOTE: This does NOT create a new page — it just sets y to the bottom
    // of the current page so that any subsequent content (like the override
    // note below) will trigger a page break via pdfkit's auto-flow.
    y = pageMaxY;
  }'''

s = s[:i0] + NEW + s[i1:]
open(P, "w").write(s)
print("certificate block replaced:", len(old_block), "->", len(NEW), "chars")
