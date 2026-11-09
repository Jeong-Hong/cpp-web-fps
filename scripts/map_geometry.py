"""Turn stair collision ramps into shared render and physics triangles."""
from collections import defaultdict
import math
import struct

HEADER = struct.Struct("<4sI")
SURFACE = struct.Struct("<9fI")
STEP_HEIGHT = 0.18
STAIR_FLAGS = 1 | 2


def difference(a, b):
    return tuple(x - y for x, y in zip(a, b))


def cross(a, b):
    ax, ay, az = a
    bx, by, bz = b
    return (ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)


def clip_height(polygon, height, keep_above):
    if not polygon:
        return []
    result = []
    previous = polygon[-1]
    for current in polygon:
        before = previous[1] >= height if keep_above else previous[1] <= height
        after = current[1] >= height if keep_above else current[1] <= height
        if before != after:
            fraction = (height - previous[1]) / (current[1] - previous[1])
            result.append((previous[0] + fraction * (current[0] - previous[0]), height,
                           previous[2] + fraction * (current[2] - previous[2])))
        if after:
            result.append(current)
        previous = current
    return result


def pack_face(a, b, c, direction, output):
    normal = cross(difference(b, a), difference(c, a))
    if math.hypot(*normal) < 1e-6:
        return
    if sum(x * y for x, y in zip(normal, direction)) < 0:
        b, c = c, b
    output.append(SURFACE.pack(*a, *b, *c, STAIR_FLAGS))


def make_steps(flight, low, high, downhill):
    count = max(2, round((high - low) / STEP_HEIGHT))
    rise = (high - low) / count
    result = []
    for _, triangle, _ in flight:
        for step in range(count):
            bottom = low + step * rise
            top = high if step == count - 1 else low + (step + 1) * rise
            polygon = clip_height(clip_height(triangle, bottom, True), top, False)
            tread = [(x, bottom, z) for x, _, z in polygon]
            for i in range(1, len(tread) - 1):
                pack_face(tread[0], tread[i], tread[i + 1], (0, 1, 0), result)
            for i, point in enumerate(polygon):
                j = (i + 1) % len(polygon)
                if point[1] == top and polygon[j][1] == top:
                    pack_face(tread[i], tread[j], polygon[j], downhill, result)
                    pack_face(tread[i], polygon[j], point, downhill, result)
    return result


def connected_flights(faces):
    parents = list(range(len(faces)))
    vertices = {}

    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    for index, (_, triangle, _) in enumerate(faces):
        for point in triangle:
            key = tuple(round(value, 3) for value in point)
            previous = vertices.setdefault(key, index)
            parents[root(index)] = root(previous)
    flights = defaultdict(list)
    for index, face in enumerate(faces):
        flights[root(index)].append(face)
    return flights.values()


def bake_stairs(data, name):
    groups = defaultdict(list)
    records = memoryview(data)[HEADER.size:]
    for index, face in enumerate(SURFACE.iter_unpack(records)):
        if face[9] & 1:
            continue
        a, b, c = face[:3], face[3:6], face[6:9]
        nx, ny, nz = cross(difference(b, a), difference(c, a))
        if abs(ny) < 1e-5:
            continue
        slope = math.hypot(nx, nz) / abs(ny)
        stair_pitch = .61 <= slope <= .73
        # Cafe's recessed terraces use a shallower, repeated stair profile.
        terrace = name == "cafe" and .32 <= slope <= .35 and min(a[1], b[1], c[1]) < -.4
        if not (stair_pitch or terrace):
            continue
        signed_length = math.copysign(math.hypot(nx, ny, nz), ny)
        normal = tuple(round(component / signed_length, 4) for component in (nx, ny, nz))
        offset = round(sum(x * y for x, y in zip(normal, a)), 2)
        groups[(normal, offset)].append((index, (a, b, c), abs(ny) / 2))

    replaced = set()
    generated = []
    flight_count = 0
    for ((nx, _, nz), _), faces in groups.items():
        length = math.hypot(nx, nz)
        ux, uz = -nx / length, -nz / length
        for flight in connected_flights(faces):
            points = [point for _, triangle, _ in flight for point in triangle]
            along = [ux * x + uz * z for x, _, z in points]
            across = [-uz * x + ux * z for x, _, z in points]
            heights = [y for _, y, _ in points]
            run, width = max(along) - min(along), max(across) - min(across)
            low, high = min(heights), max(heights)
            if not (1.05 < run < 10 and .75 < width < 5.5 and .54 < high - low < 6):
                continue
            coverage = sum(area for _, _, area in flight) / (run * width)
            if not .65 <= coverage <= 1.35:
                continue
            steps = make_steps(flight, low, high, (-ux, 0, -uz))
            if steps:
                replaced.update(index for index, _, _ in flight)
                generated.extend(steps)
                flight_count += 1

    count = len(records) // SURFACE.size
    total = count - len(replaced) + len(generated)
    if total > 200000:
        raise SystemExit(f"Converted map exceeds triangle limit: {name}")
    output = bytearray(HEADER.pack(b"CYA1", total))
    for index in range(count):
        if index not in replaced:
            output.extend(records[index * SURFACE.size:(index + 1) * SURFACE.size])
    for face in generated:
        output.extend(face)
    print(f"MAP {name}: {flight_count} stair flights, {total} triangles", flush=True)
    return output
