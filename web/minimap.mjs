const floorColors = ['#263733', '#344a43', '#425c50', '#536e61'];
const teamColors = ['#78bdff', '#ffa17a'];

export function createMinimap(canvas) {
  const context = canvas.getContext('2d');
  const background = document.createElement('canvas');
  background.width = canvas.width;
  background.height = canvas.height;
  const surface = background.getContext('2d');
  const size = canvas.width;
  const pad = 8;
  let projection;

  function setWorld(geometry, mesh, [minX, maxX, minZ, maxZ]) {
    const scale = (size - 2 * pad) / Math.max(maxX - minX, maxZ - minZ);
    const x = value => size / 2 + (value - (minX + maxX) / 2) * scale;
    const z = value => size / 2 + (value - (minZ + maxZ) / 2) * scale;
    projection = { x, z };
    surface.fillStyle = '#101b1a';
    surface.fillRect(0, 0, size, size);
    surface.save();
    surface.beginPath();
    surface.rect(x(minX), z(minZ), (maxX - minX) * scale, (maxZ - minZ) * scale);
    surface.clip();
    if (mesh) {
      const floors = floorColors.map(() => new Path2D());
      const walls = new Path2D();
      for (let i = 0; i < geometry.length; i += 18) {
        const flat = Math.abs(geometry[i + 4]) > 0.65;
        const elevation = (geometry[i + 1] + geometry[i + 7] + geometry[i + 13]) / 3;
        const band = Math.max(0, Math.min(floors.length - 1, Math.floor((elevation + 1) / 3)));
        const path = flat ? floors[band] : walls;
        const a = [x(geometry[i]), z(geometry[i + 2])];
        const b = [x(geometry[i + 6]), z(geometry[i + 8])];
        const c = [x(geometry[i + 12]), z(geometry[i + 14])];
        const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        // Normalize winding so overlapping faces do not cut holes in a floor band.
        path.moveTo(...a);
        path.lineTo(...(area >= 0 ? b : c));
        path.lineTo(...(area >= 0 ? c : b));
        path.closePath();
      }
      for (let i = 0; i < floors.length; i++) {
        surface.fillStyle = floorColors[i];
        surface.fill(floors[i]);
      }
      surface.strokeStyle = '#71928855';
      surface.lineWidth = 0.65;
      surface.stroke(walls);
    } else {
      surface.fillStyle = floorColors[0];
      surface.fillRect(x(minX), z(minZ), (maxX - minX) * scale, (maxZ - minZ) * scale);
      surface.fillStyle = floorColors[3];
      for (let i = 0; i < geometry.length; i += 4) {
        const [cx, cz, width, depth] = geometry.subarray(i, i + 4);
        surface.fillRect(x(cx - width / 2), z(cz - depth / 2), width * scale, depth * scale);
      }
    }
    surface.restore();
    surface.strokeStyle = '#8fada130';
    surface.lineWidth = 1;
    for (let offset = 24.5; offset < size; offset += 24) {
      surface.beginPath();
      surface.moveTo(offset, 0); surface.lineTo(offset, size);
      surface.moveTo(0, offset); surface.lineTo(size, offset);
      surface.stroke();
    }
  }

  function draw(x, z, yaw, allies, alive) {
    if (!projection) return;
    const clamp = value => Math.max(pad, Math.min(size - pad, value));
    context.drawImage(background, 0, 0);
    for (const ally of allies) {
      context.beginPath();
      context.arc(clamp(projection.x(ally.x)), clamp(projection.z(ally.z)), 4, 0, 2 * Math.PI);
      context.fillStyle = teamColors[ally.team];
      context.fill();
      context.strokeStyle = '#101b1a';
      context.lineWidth = 1.5;
      context.stroke();
    }
    context.save();
    context.translate(clamp(projection.x(x)), clamp(projection.z(z)));
    context.rotate(yaw);
    context.beginPath();
    context.moveTo(0, -7); context.lineTo(5, 5); context.lineTo(0, 3); context.lineTo(-5, 5); context.closePath();
    context.fillStyle = alive ? '#e9ff70' : '#bac7bf';
    context.strokeStyle = '#101b1a';
    context.lineWidth = 1.5;
    context.stroke();
    context.fill();
    context.restore();
  }

  return { setWorld, draw };
}
