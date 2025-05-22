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

interface Env {
	LINKS: KVNamespace;
	API_KEY: string;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;

		// === GET Handler: Redirect logic ===
		if (request.method === 'GET') {
			const slug = pathname.split('/')[2] || '';

			if (!slug) {
				return new Response(null, { status: 200 });
			}

			const target = await env.LINKS.get(slug);

			if (target) {
				return Response.redirect(target, 302);
			} else {
				return new Response('Thread not found', { status: 404 });
			}
		}

		// === POST Handler: Auth-protected shortener endpoint ===
		if (request.method === 'POST' && pathname === '/shorten') {
			const auth = request.headers.get('Authorization');
			if (!auth) {
				return new Response('You need to login.', {
					status: 401,
					headers: {
						'WWW-Authenticate': 'Basic realm="my scope", charset="UTF-8"',
					},
				});
			}

			const [scheme, encoded] = auth.split(' ');
			if (!encoded || scheme !== 'Basic') {
				return new Response('Malformed authorization header.', { status: 400 });
			}

			const credentials = Buffer.from(encoded, 'base64').toString();
			const index = credentials.indexOf(':');

			if (index === -1) {
				return new Response('Malformed credentials.', { status: 400 });
			}

			const user = credentials.substring(0, index);
			const pass = credentials.substring(index + 1);

			if (!timingSafeEqual(user, 'admin') || !timingSafeEqual(pass, env.API_KEY)) {
				return new Response('Unauthorized.', {
					status: 401,
					headers: {
						'WWW-Authenticate': 'Basic realm="my scope", charset="UTF-8"',
					},
				});
			}

			let payload: { slug: string; target: string };
			try {
				payload = await request.json();
			} catch {
				return new Response('Invalid JSON body.', { status: 400 });
			}

			const { slug, target } = payload;
			if (!slug || !target) {
				return new Response('Missing slug or target.', { status: 400 });
			}

			await env.LINKS.put(slug, target);
			return new Response(`Shortened: https://thrd.me/${slug}`, {
				status: 200,
			});
		}

		// === Fallback ===
		return new Response('Thread not found.', { status: 404 });
	},
};
