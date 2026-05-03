import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const apiRoot = path.join(process.cwd(), "src", "app", "api");

const sensitivePattern =
  /(password|secretAccessKey|accessKeyId|serviceAccountKey|private_key|client_email|tokenSecret|consumerSecret|refresh_token|PGPASSWORD|credentials)/i;

interface Finding {
  file: string;
  line: number;
  message: string;
  strong: boolean;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return walk(fullPath);
    return fullPath.endsWith(".ts") ? [fullPath] : [];
  });
}

function lineNumberForOffset(source: string, offset: number): number {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function hasSafeSerializer(line: string): boolean {
  return /serialize[A-Z]\w+/.test(line);
}

function inspectFile(file: string): Finding[] {
  const source = readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  const findings: Finding[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (/NextResponse\.json\(\s*(connection|connections|target|targets)\b/.test(trimmed) && !hasSafeSerializer(trimmed)) {
      findings.push({
        file,
        line: index + 1,
        message: "Potential raw credential-bearing object returned through NextResponse.json",
        strong: true,
      });
    }

    if (/console\.(log|error|warn)/.test(trimmed) && sensitivePattern.test(trimmed) && !/safeErrorMessage|redact/i.test(trimmed)) {
      findings.push({
        file,
        line: index + 1,
        message: "Console output mentions credential-like fields without a redaction helper",
        strong: true,
      });
    }
  });

  const credentialSelectPattern = /select\s*:\s*{[\s\S]*?credentials\s*:\s*true[\s\S]*?}/gi;
  for (const match of source.matchAll(credentialSelectPattern)) {
    const after = source.slice(match.index ?? 0, (match.index ?? 0) + 1500);
    if (/NextResponse\.json\(\s*(connection|connections|target|targets)\b/.test(after) && !/serialize[A-Z]\w+/.test(after)) {
      findings.push({
        file,
        line: lineNumberForOffset(source, match.index ?? 0),
        message: "credentials are selected near a raw response without an obvious serializer",
        strong: true,
      });
    }
  }

  return findings;
}

const findings = walk(apiRoot).flatMap(inspectFile);
const strongFindings = findings.filter((finding) => finding.strong);

if (findings.length > 0) {
  console.error("Credential response scan findings:");
  for (const finding of findings) {
    console.error(`${path.relative(process.cwd(), finding.file)}:${finding.line} ${finding.message}`);
  }
}

if (strongFindings.length > 0) {
  process.exit(1);
}

console.log("Credential response scan passed.");
