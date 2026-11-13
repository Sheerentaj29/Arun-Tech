(() => {
  const values = {
    "Testing Standard": "ASME Section V 2023, Article 7",
    "Acceptance Criteria": "ASME Section VIII Div. 1, Appx. 6",
    "Surface Preparation": "Grinding and wire brush",
    "Surface Temperature": "32 C",
    "Type of Instrument / Sl. No.": "AC Yoke / 201501012123",
    "MPT Method": "Wet Continuous",
    "Type of Current": "AC",
    "AC Yoke Lifting Capacity": "5 kg / 50 N",
    "Contrast Medium": "White contrast",
    "Method of Pre-cleaning": "Solvent cleaning",
    "Method of Applying White Contrast": "Spray",
    "AC Yoke Pole Spacing": "150 mm",
    "Magnetic Medium": "Wet particle iron ink",
    "Method of Applying Magnetic Medium": "Spray",
    "Development Time": "5 minutes",
    "Interpretation Time": "10 minutes",
    "Lighting Equipment": "LED torch >= 1000 lux",
    "Post Cleaning": "Solvent wipe"
  };
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, "value"
  ).set;
  const result = [];
  for (const [label, val] of Object.entries(values)) {
    const tds = Array.from(document.querySelectorAll("td"));
    const td = tds.find((c) => c.textContent.trim() === label);
    if (!td) { result.push(label + ": LABEL NOT FOUND"); continue; }
    const input = td.closest("tr")?.querySelector("input");
    if (!input) { result.push(label + ": INPUT NOT FOUND"); continue; }
    nativeSetter.call(input, val);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    result.push(label + "=" + input.value);
  }
  return result.join(" | ");
})()
