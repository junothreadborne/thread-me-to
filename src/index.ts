import { Buffer } from 'node:buffer';

const encoder = new TextEncoder();

function timingSafeEqual(a: string, b: string): boolean {
	const aBytes = encoder.encode(a);
	const bBytes = encoder.encode(b);

	if (aBytes.byteLength !== bBytes.byteLength) {
		return false;
	}

	return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

async function checkBasicAuth(request: Request, env: Env): Promise<boolean> {
	const auth = request.headers.get('Authorization');
	if (!auth) return false;

	const [scheme, encoded] = auth.split(' ');
	if (!encoded || scheme !== 'Basic') return false;

	const credentials = Buffer.from(encoded, 'base64').toString();
	const index = credentials.indexOf(':');
	if (index === -1) return false;

	const user = credentials.substring(0, index);
	const pass = credentials.substring(index + 1);

	return timingSafeEqual(user, 'admin') && timingSafeEqual(pass, env.API_KEY);
}

async function getSlugData(env: Env, slug: string) {
	return env.LINKS.get(slug, 'json');
}

interface Env {
	LINKS: KVNamespace;
	API_KEY: string;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;

		// === GET /api/all → list all KV entries
		if (request.method === 'GET' && pathname === '/to/api/all') {
			const keys = await env.LINKS.list();
			const allData = [];

			for (const key of keys.keys) {
				const value = await getSlugData(env, key.name);
				if (value) {
					allData.push({ slug: key.name, ...value });
				}
			}

			return new Response(JSON.stringify(allData), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// === GET /to/:slug → redirect
		if (request.method === 'GET' && pathname.startsWith('/to/')) {
			const slug = pathname.split('/')[2] || '';
			const target = await env.LINKS.get(slug);
			const data = JSON.parse(target || '{}');

			if (data && data.url) {
				return Response.redirect(data.url, 302);
			} else {
				return new Response('Thread not found.', { status: 404 });
			}
		}

		// === POST /shorten → add new slug (auth-protected)
		if (request.method === 'POST' && pathname === '/shorten') {
			const authorized = await checkBasicAuth(request, env);
			if (!authorized) {
				return new Response('Unauthorized.', {
					status: 401,
					headers: {
						'WWW-Authenticate': 'Basic realm="the-elsebeneath", charset="UTF-8"',
					},
				});
			}

			let payload: { slug: string; target: string; data?: any };
			try {
				payload = await request.json();
			} catch {
				return new Response('Invalid JSON body.', { status: 400 });
			}

			const { slug, target, data } = payload;
			if (!slug || !target) {
				return new Response('Missing slug or target.', { status: 400 });
			}

			// Store as a JSON object (with optional metadata)
			await env.LINKS.put(slug, JSON.stringify({ target, ...data }));

			return new Response(`Shortened: https://thrd.me/to/${slug}`, {
				status: 200,
			});
		}

		// === Fallback
		return new Response('Not Found.', { status: 404 });
	},
};
