// Regenerate the file:// compatible dialogue bundle after editing any JSON file.
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const animals = {};
for (const filename of fs.readdirSync(path.join(root, 'animals')).filter(name => name.endsWith('.json')).sort()) {
  const id = path.basename(filename, '.json');
  animals[id] = JSON.parse(fs.readFileSync(path.join(root, 'animals', filename), 'utf8'));
}
const branches = JSON.parse(fs.readFileSync(path.join(root, 'branches.json'), 'utf8'));
for (const [id, lines] of Object.entries(branches.conversations)) {
  if (!animals[id]) throw new Error(`Missing animal: ${id}`);
  for (const line of lines) {
    for (const grant of line.grants || []) {
      if (!branches.evidence[grant] && !branches.clues[grant] && !['dog_patrol', 'crow_guard', 'cooperative_defense'].includes(grant)) {
        throw new Error(`Unknown grant ${grant} in ${line.id}`);
      }
    }
  }
}
fs.writeFileSync(path.join(root, 'bundle.js'),
  '// Generated from dialogues/animals/*.json and dialogues/branches.json. Run node dialogues/build-bundle.cjs after edits.\n' +
  'window.FARM_DIALOGUES = ' + JSON.stringify({ animals, branches }) + ';\n');
console.log(`Bundled ${Object.keys(animals).length} animals and ${Object.values(branches.conversations).flat().length} conversations`);
