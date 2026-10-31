function description(info: unknown): string {
	if (typeof info === "string") return info.trim();
	if (!info || typeof info !== "object") return "";
	const problem = info as Record<string, unknown>;
	const details = Array.isArray(problem.errors)
		? problem.errors.map((item: unknown) => {
				if (!item || typeof item !== "object") return "";
				const { location, message } = item as Record<string, unknown>;
				return typeof message === "string"
					? `${typeof location === "string" && location ? `${location}: ` : ""}${message}`
					: "";
			}).filter(Boolean).join("; ")
		: "";
	if (details) return details;
	for (const key of ["detail", "message", "title"]) {
		const value = problem[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return "";
}

/** API failures retain the parsed body (or raw text) for programmatic inspection. */
export class GaiusHttpError extends Error {
	constructor(readonly status: number, readonly info: unknown, statusText = "") {
		const detail = description(info) || statusText;
		super(`HTTP ${status}${detail ? `: ${detail}` : ""}`);
		this.name = "GaiusHttpError";
	}
}

export async function throwHttpError(response: Response): Promise<never> {
	const body = await response.text();
	let info: unknown = body || {};
	try {
		if (body) info = JSON.parse(body);
	} catch {
		// Proxies and gateways may return plain text rather than a JSON problem.
	}
	throw new GaiusHttpError(response.status, info, response.statusText);
}
