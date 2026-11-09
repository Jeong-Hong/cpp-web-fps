"""Build the small playable-area CROSSYARD pack from the offline GLB."""
import json
import struct
import sys
from collections import Counter
from pathlib import Path


# Contents masks used by the CROSSYARD approximation. The full GLB retains
# every original shape tag for inspection and alternate filtering.
PLAYER_SURFACE = 0x20000
VISIBLE_SURFACE = 0x4000000


def pack(source, destination):
    glb = source.read_bytes()
    magic, version, size, json_size, kind = struct.unpack_from('<4sIII4s', glb)
    assert (magic, version, size, kind) == (b'glTF', 2, len(glb), b'JSON')
    gltf = json.loads(glb[20:20 + json_size])
    blob = memoryview(glb)[28 + json_size:]

    def accessor(index):
        a = gltf['accessors'][index]
        v = gltf['bufferViews'][a['bufferView']]
        start = v['byteOffset']
        return blob[start:start + v['byteLength']], a['count']

    totals = Counter()
    pack_triangle = struct.Struct('<9fI').pack
    with destination.open('wb') as f:
        f.write(b'CYA1\x00\x00\x00\x00')
        for mesh in gltf['meshes']:
            if int(mesh['name'].split('_')[1]) not in (28, 29, 36, 37):
                continue
            for primitive in mesh['primitives']:
                point_bytes, count = accessor(primitive['attributes']['POSITION'])
                points = list(struct.iter_unpack('<3f', point_bytes))
                assert len(points) == count
                indices, _ = accessor(primitive['indices'])
                contents = gltf['extras']['shapeTags'][primitive['extras']['shapeTag']]['contents']
                if not contents & PLAYER_SURFACE:
                    continue
                flags = 1 if contents & VISIBLE_SURFACE else 0
                for a, b, c in struct.iter_unpack('<3I', indices):
                    triangle = (points[a], points[b], points[c])
                    axes = list(zip(*triangle))
                    if any(max(axis) < lo or min(axis) > hi for axis, (lo, hi) in
                           zip(axes, ((-95, 95), (-15, 45), (-76, 76)))):
                        continue
                    f.write(pack_triangle(*(coord * 0.8128 for point in triangle for coord in point), flags))
                    totals[flags] += 1
        f.seek(4)
        f.write(struct.pack('<I', sum(totals.values())))
    print(dict(totals), destination.stat().st_size)


if __name__ == '__main__':
    pack(Path(sys.argv[1]), Path(sys.argv[2]))
