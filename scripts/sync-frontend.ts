import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Vendor the existing frontend's rules so published packages remain standalone.
const source = resolve(process.argv[2] ?? "../gaius/app/src");
const target = resolve(import.meta.dir, "../src/frontend");
await mkdir(target, { recursive: true });
for (const [input, output] of [
	["schemas/case.ts", "case.ts"],
	["schemas/case-answers.ts", "case-answers.ts"],
	["common/document-files.ts", "document-files.ts"],
	["common/case-create.ts", "case-create.ts"],
] as const) {
	let content = await readFile(resolve(source, input), "utf8");
	content = content
		.replaceAll("'@/api/model'", "'../api/model.js'")
		.replaceAll("'./case'", "'./case.js'")
		.replaceAll("'@/schemas/case-answers'", "'./case-answers.js'")
		.replaceAll(
			"import type { FileUploadInput } from '@/hooks/use-file-upload'",
			"type FileUploadInput = { url: string; method: string; headers: Headers; file: File }",
		);
	await writeFile(
		resolve(target, output),
		`// Synced from gaius/app/src/${input}. Run bun run sync:frontend to update.\n${content}`,
	);
}
