import { lzwDecode } from "./population";

// A TIFF LZW encoder as libtiff writes it (codes widen when the next free
// entry passes the width, the decoder one entry earlier; a clear before the
// table is full), to check the decoder of the population tool.
function lzwEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let pending = 0;
  let bits = 9;
  const write = (code: number): void => {
    buffer = buffer * (1 << bits) + code;
    pending += bits;
    while (pending >= 8) {
      const shift = pending - 8;
      out.push(Math.floor(buffer / 2 ** shift) & 0xff);
      buffer %= 2 ** shift;
      pending -= 8;
    }
  };
  let table = new Map<string, number>();
  let next = 258;
  write(256);
  let w = "";
  for (const byte of data) {
    const wc = w === "" ? String(byte) : `${w},${byte}`;
    if (w === "" || table.has(wc)) {
      w = wc;
      continue;
    }
    write(w.includes(",") ? table.get(w)! : Number(w));
    table.set(wc, next++);
    if (next > (1 << bits) - 1 && bits < 12) bits++;
    if (next >= 4094) {
      write(256);
      table = new Map();
      next = 258;
      bits = 9;
    }
    w = String(byte);
  }
  if (w !== "") write(w.includes(",") ? table.get(w)! : Number(w));
  write(257);
  if (pending > 0) out.push((buffer * 2 ** (8 - pending)) & 0xff);
  return Uint8Array.from(out);
}

describe("the LZW decoder of the population tool (J7)", () => {
  it("gives back what libtiff's scheme encodes, through clears and 12-bit codes", () => {
    const data = new Uint8Array(70_000);
    let seed = 12345;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      // Runs and a small alphabet, as float64 rasters give.
      data[i] = i % 97 < 40 ? 0 : (seed >> 16) % 7;
    }
    const encoded = lzwEncode(data);
    const out = new Uint8Array(data.length);
    expect(lzwDecode(encoded, out)).toBe(data.length);
    expect(Buffer.from(out).equals(Buffer.from(data))).toBe(true);
  });
});
