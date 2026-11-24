"""Gera os ícones do Mixi (mascote de fone) sem dependências externas.

Saída em src-tauri/icons/: icon.ico (multi-tamanho), icon.png (256) e tray.png (32, traço mais grosso).
Uso: python tools/make_icons.py
"""
import os
import struct
import zlib

ACC = (0xE8, 0x67, 0x9F)
INK = (0xA3, 0x32, 0x6B)
EYE = (0x2B, 0x1D, 0x2F)
CHEEK = (0xFF, 0xC4, 0xDC)


def bez3(p0, p1, p2, p3, n=90):
    pts = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
        pts.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return pts


def bez2(p0, p1, p2, n=40):
    pts = []
    for i in range(n + 1):
        t = i / n
        a, b, c = (1 - t) ** 2, 2 * (1 - t) * t, t * t
        pts.append((a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]))
    return pts


BAND = bez3((8, 27), (8, 7), (40, 7), (40, 27))
SMILE = bez2((21.5, 31), (24, 33.6), (26.5, 31))


def near(pts, x, y, r):
    r2 = r * r
    return any((x - px) ** 2 + (y - py) ** 2 <= r2 for px, py in pts)


def rrect(x, y, rx, ry, w, h, r):
    if not (rx <= x <= rx + w and ry <= y <= ry + h):
        return False
    cx = min(max(x, rx + r), rx + w - r)
    cy = min(max(y, ry + r), ry + h - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def shade(x, y, bold):
    c = None
    if 4 <= x <= 44 and 9 <= y <= 30 and near(BAND, x, y, 2.4 if bold else 1.75):
        c = INK
    if rrect(x, y, 10, 13, 28, 29, 13):
        c = ACC
    if rrect(x, y, 4, 23, 8, 13, 4) or rrect(x, y, 36, 23, 8, 13, 4):
        c = INK
    er = 3.1 if bold else 2.4
    if (x - 19.5) ** 2 + (y - 26) ** 2 <= er * er or (x - 28.5) ** 2 + (y - 26) ** 2 <= er * er:
        c = EYE
    if not bold and ((((x - 16) / 2.8) ** 2 + ((y - 31.5) / 1.8) ** 2) <= 1 or (((x - 32) / 2.8) ** 2 + ((y - 31.5) / 1.8) ** 2) <= 1):
        c = CHEEK
    if 19 <= x <= 29 and 28.5 <= y <= 35 and near(SMILE, x, y, 1.4 if bold else 1.0):
        c = EYE
    return c


def render(size, bold=False):
    ss = 4 if size <= 64 else 2
    # viewBox 48 recortado para 2..46 (44 unidades), assim o mascote ocupa o ícone todo
    scale = 44.0 / size
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    x = 2 + (px + (sx + 0.5) / ss) * scale
                    y = 2 + (py + (sy + 0.5) / ss) * scale
                    c = shade(x, y, bold)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 1
            n = ss * ss
            if a:
                row += bytes((int(r / a), int(g / a), int(b / a), int(255 * a / n)))
            else:
                row += b"\0\0\0\0"
        rows.append(bytes(row))
    return rows


def png_bytes(rows, size):
    raw = b"".join(b"\0" + r for r in rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")
    os.makedirs(out, exist_ok=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    pngs = {s: png_bytes(render(s), s) for s in sizes}
    header = struct.pack("<HHH", 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    entries, blobs = b"", b""
    for s in sizes:
        data = pngs[s]
        entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), offset + len(blobs))
        blobs += data
    with open(os.path.join(out, "icon.ico"), "wb") as f:
        f.write(header + entries + blobs)
    with open(os.path.join(out, "icon.png"), "wb") as f:
        f.write(pngs[256])
    with open(os.path.join(out, "tray.png"), "wb") as f:
        f.write(png_bytes(render(32, bold=True), 32))
    print("icones gerados em", os.path.abspath(out))


if __name__ == "__main__":
    main()
