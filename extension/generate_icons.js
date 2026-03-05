// Run with Node.js to generate simple placeholder icons
// node generate_icons.js
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];

sizes.forEach(size => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#4361ee');
  gradient.addColorStop(1, '#7209b7');
  ctx.fillStyle = gradient;
  ctx.roundRect(0, 0, size, size, size * 0.15);
  ctx.fill();

  // Camera icon
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'white';
  ctx.lineWidth = size * 0.05;

  // Camera body
  const margin = size * 0.15;
  const bodyY = size * 0.35;
  const bodyH = size * 0.45;
  ctx.beginPath();
  ctx.roundRect(margin, bodyY, size - margin * 2, bodyH, size * 0.1);
  ctx.fill();

  // Lens (dark circle)
  ctx.fillStyle = '#4361ee';
  const cx = size / 2;
  const cy = bodyY + bodyH / 2;
  const r = bodyH * 0.3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Flash bump
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.roundRect(size * 0.35, bodyY - size * 0.12, size * 0.3, size * 0.14, size * 0.05);
  ctx.fill();

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(__dirname, `icons/icon${size}.png`), buffer);
  console.log(`Generated icon${size}.png`);
});
