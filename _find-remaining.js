const r = JSON.parse(require('fs').readFileSync('eslint-report.json','utf8'));
const byFile = {};
for (const f of r) {
  const path = f.filePath;
  const idx = path.indexOf('worktrees');
  const file = idx >= 0 ? path.slice(path.indexOf('/', idx + 10) + 1) : path;
  for (const m of f.messages) {
    if (m.ruleId === '@typescript-eslint/no-unused-vars') {
      if (!byFile[file]) byFile[file] = [];
      byFile[file].push({ line: m.line, msg: m.message.slice(0, 130) });
    }
  }
}
let total = 0;
for (const [file, msgs] of Object.entries(byFile).sort()) {
  console.log('\n' + file);
  for (const m of msgs) {
    const isImplied = m.msg.includes('_ignored') || m.msg.includes('_ct') || m.msg.includes(' _e ') || m.msg.includes("'_e'");
    console.log('  L' + m.line + '  ' + m.msg.slice(0, 120) + (isImplied ? ' [IGNORED]' : ''));
    if (!isImplied) total++;
  }
}
console.log('\n=== Remaining non-ignored: ' + total + ' ===');
