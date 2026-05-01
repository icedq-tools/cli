export class Reporter {
  constructor(format = 'text') {
    this.format = format;
  }

  emit(result) {
    switch (this.format) {
      case 'json':
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return;
      case 'markdown':
        process.stdout.write(toMarkdown(result) + '\n');
        return;
      case 'text':
      default:
        process.stdout.write(toText(result) + '\n');
    }
  }
}

function toText(r) {
  const lines = [];
  lines.push(`Command:   ${r.command}`);
  if (r.taskId) lines.push(`Task ID:   ${r.taskId}`);
  lines.push(`Status:    ${r.status}`);
  if (r.durationMs !== undefined) lines.push(`Duration:  ${(r.durationMs / 1000).toFixed(1)}s`);
  if (r.outputFile) lines.push(`Output:    ${r.outputFile}`);
  if (r.skippedCount !== undefined) lines.push(`Skipped:   ${r.skippedCount}`);

  if (r.skippedRules?.length) {
    lines.push('');
    lines.push('Skipped rules:');
    for (const s of r.skippedRules) lines.push(`  - ${s.name}: ${s.reason}`);
  }
  if (r.hardErrors?.length) {
    lines.push('');
    lines.push('Errors:');
    for (const e of r.hardErrors) lines.push(`  - ${e}`);
  }
  return lines.join('\n');
}

function toMarkdown(r) {
  const lines = [];
  lines.push(`## iceDQ ${r.command}`);
  lines.push('');
  lines.push(`- **Status:** ${r.status}`);
  if (r.taskId) lines.push(`- **Task ID:** \`${r.taskId}\``);
  if (r.durationMs !== undefined) lines.push(`- **Duration:** ${(r.durationMs / 1000).toFixed(1)}s`);
  if (r.outputFile) lines.push(`- **Output:** \`${r.outputFile}\``);
  if (r.skippedCount !== undefined) lines.push(`- **Skipped:** ${r.skippedCount}`);

  if (r.skippedRules?.length) {
    lines.push('');
    lines.push('### Skipped rules');
    for (const s of r.skippedRules) lines.push(`- \`${s.name}\` — ${s.reason}`);
  }
  if (r.hardErrors?.length) {
    lines.push('');
    lines.push('### Errors');
    for (const e of r.hardErrors) lines.push(`- ${e}`);
  }
  return lines.join('\n');
}
