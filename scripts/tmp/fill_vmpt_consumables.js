(() => {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, "value"
  ).set;
  function setVal(input, val) {
    nativeSetter.call(input, val);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const result = [];
  // ── Consumables table: rows identified by first-cell label ──
  const consData = {
    "White Contrast": ["Magnaflux", "WCP-1 white contrast paint", "WC-LOT-2026-11", "Nov-2027"],
    "Wet Particle Iron Ink": ["ORION", "MPI-14 wet particle iron ink", "INK-LOT-2026-04", "Dec-2026"],
  };
  for (const [label, vals] of Object.entries(consData)) {
    const tds = Array.from(document.querySelectorAll("td"));
    const td = tds.find((c) => c.textContent.trim() === label);
    if (!td) { result.push(label + ": NOT FOUND"); continue; }
    const inputs = td.closest("tr").querySelectorAll("input");
    vals.forEach((v, i) => { if (inputs[i]) { setVal(inputs[i], v); } });
    result.push(label + " filled " + inputs.length + " inputs");
  }
  return result.join(" | ");
})()
