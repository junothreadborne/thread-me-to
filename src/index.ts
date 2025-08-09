import { Buffer } from 'node:buffer';
import { marked } from 'marked';

marked.setOptions({
	gfm: true,
	breaks: true,
	pedantic: false,
});

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

// === Story Customization Logic ===

const PRONOUNS = {
	she: {
		subject: 'she',
		object: 'her',
		possessiveAdj: 'her',
		possessive: 'hers',
		reflexive: 'herself',
	},
	he: {
		subject: 'he',
		object: 'him',
		possessiveAdj: 'his',
		possessive: 'his',
		reflexive: 'himself',
	},
	they: {
		subject: 'they',
		object: 'them',
		possessiveAdj: 'their',
		possessive: 'theirs',
		reflexive: 'themselves',
	},
} as const;

type PronounKey = keyof typeof PRONOUNS;

function rewritePronouns(text: string, originalName: string, targetName: string, pronounKey: PronounKey = 'he'): string {
	const originalPronouns = PRONOUNS['he']; // assume original uses he/him
	const newPronouns = PRONOUNS[pronounKey] || PRONOUNS['he'];

	const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

	const replacements: Array<[RegExp, string | ((match: string) => string)]> = [
		[new RegExp(`\\b${originalName}\\b`, 'g'), targetName],
		[new RegExp(`\\b${originalName.toLowerCase()}\\b`, 'g'), targetName.toLowerCase()],
		[
			new RegExp(`\\b${originalPronouns.subject}\\b`, 'gi'),
			(match) => (match[0] === match[0].toUpperCase() ? capitalize(newPronouns.subject) : newPronouns.subject),
		],
		[
			new RegExp(`\\b${originalPronouns.object}\\b`, 'gi'),
			(match) => (match[0] === match[0].toUpperCase() ? capitalize(newPronouns.object) : newPronouns.object),
		],
		[
			new RegExp(`\\b${originalPronouns.possessiveAdj}\\b`, 'gi'),
			(match) => (match[0] === match[0].toUpperCase() ? capitalize(newPronouns.possessiveAdj) : newPronouns.possessiveAdj),
		],
		[
			new RegExp(`\\b${originalPronouns.possessive}\\b`, 'gi'),
			(match) => (match[0] === match[0].toUpperCase() ? capitalize(newPronouns.possessive) : newPronouns.possessive),
		],
		[
			new RegExp(`\\b${originalPronouns.reflexive}\\b`, 'gi'),
			(match) => (match[0] === match[0].toUpperCase() ? capitalize(newPronouns.reflexive) : newPronouns.reflexive),
		],
	];

	let result = text;
	for (const [pattern, replacement] of replacements) {
		result = result.replace(pattern, replacement);
	}
	return result;
}

// Post-process marked HTML to add our custom classes
function addStoryClasses(html: string): string {
	return html
		.replace(/<h1>/g, '<h1 class="chapter-title">')
		.replace(/<h2>/g, '<h2 class="section-title">')
		.replace(/<h3>/g, '<h3 class="subsection-title">')
		.replace(/<p>/g, '<p class="story-text">')
		.replace(/<ul>/g, '<ul class="bullet-list">')
		.replace(/<ol>/g, '<ol class="numbered-list">')
		.replace(/<blockquote>/g, '<blockquote class="story-callout">')
		.replace(/<img /g, '<img class="story-image" ');
}

function markdownToHTML(markdown: string): string {
	const manual = markdownToHTMLManual(markdown);
	const rawHTML = marked.parse(manual);
	return addStoryClasses(rawHTML);
}
// Simple markdown to HTML converter (basic implementation)
function markdownToHTMLManual(markdown: string): string {
	// First pass: handle block elements
	let html = markdown
		// Headers (must be done first)
		.replace(/^### (.*$)/gm, '<h3 class="subsection-title">$1</h3>')
		.replace(/^## (.*$)/gm, '<h2 class="section-title">$1</h2>')
		.replace(/^# (.*$)/gm, '<h1 class="chapter-title">$1</h1>');

	// Split into blocks (double line breaks)
	const blocks = html.split(/\n\s*\n/);

	const processedBlocks = blocks.map((block) => {
		block = block.trim();
		if (!block) return '';

		// Skip if it's already a header
		if (block.startsWith('<h')) {
			return block;
		}

		// Handle blockquotes
		if (block.startsWith('>')) {
			const content = block.replace(/^>\s*/gm, '');
			return `<blockquote class="story-callout">${content.replace(/\n/g, '<br>')}</blockquote>`;
		}

		// Handle blockquotes
		if (block.startsWith('>')) {
			const content = block.replace(/^>\s*/gm, '');
			return `<blockquote class="story-callout">${content.replace(/\n/g, '<br>')}</blockquote>`;
		}

		// Handle unordered lists
		if (/^[\*\-\+]\s/.test(block)) {
			const items = block
				.split('\n')
				.map((line) => {
					const match = line.match(/^[\*\-\+]\s(.+)/);
					return match ? `<li>${match[1]}</li>` : '';
				})
				.filter(Boolean)
				.join('');
			return `<ul class="bullet-list">${items}</ul>`;
		}

		// Handle ordered lists
		if (/^\d+\.\s/.test(block)) {
			const items = block
				.split('\n')
				.map((line) => {
					const match = line.match(/^\d+\.\s(.+)/);
					return match ? `<li>${match[1]}</li>` : '';
				})
				.filter(Boolean)
				.join('');
			return `<ol class="numbered-list">${items}</ol>`;
		}

		// Regular paragraphs
		return `<p class="story-text">${block.replace(/\n/g, '<br>')}</p>`;
	});

	// Join blocks and apply inline formatting
	return (
		processedBlocks
			.join('\n\n')
			// Inline formatting
			.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.*?)\*/g, '<em>$1</em>')
			.replace(/\_(.*?)\_/g, '<em>$1</em>')
			.replace(/`(.*?)`/g, '<code>$1</code>')
			// Fix any double spaces from processing
			.replace(/\n\s*\n\s*\n/g, '\n\n')
	);
}

const STORY_METADATA = {
	island: {
		title: 'The Island of Almosts',
		originalName: 'Sam',
		originalPronoun: 'he' as PronounKey,
		description: 'A magical adventure about a struggling child.',
		slug: 'island',
		image: `https://junothreadborne.me/island-cover.webp`,
	},
	// Add more stories as needed
} as const;

const STORY_CSS = `
<style>
  body {
    font-family: 'Georgia', 'Times New Roman', serif;
    line-height: 1.6;
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
    background-color: #1a1a1a;
    color: #e0e0e0;
    position: relative;
  }

  .chapter-title {
    font-size: 2.5em;
    color: #6ba3f5;
    text-align: center;
    margin: 2em 0 1em 0;
    font-weight: bold;
    text-shadow: 1px 1px 2px rgba(0,0,0,0.3);
  }

  .section-title {
    font-size: 1.8em;
    color: #6ba3f5;
    margin: 1.5em 0 0.8em 0;
    border-bottom: 2px solid #333;
    padding-bottom: 0.3em;
  }

  .subsection-title {
    font-size: 1.4em;
    color: #6ba3f5;
    margin: 1.2em 0 0.6em 0;
  }

  .story-text {
    font-size: 1.1em;
    margin-bottom: 1.2em;
    text-align: justify;
  }

  .customization-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #6ba3f5, #4a90e2);
    color: white;
    padding: 8px 16px;
    text-align: center;
    font-size: 0.9em;
    z-index: 1000;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }

  .story-container {
    margin-top: 50px;
  }

  strong { color: #e0e0e0; font-weight: bold; }
  em { color: #e0e0e0; font-style: italic; }

  @media (max-width: 768px) {
    .customization-banner {
      font-size: 0.8em;
      padding: 6px 12px;
    }
    .story-container {
      margin-top: 40px;
    }
  }
</style>`;

async function handleStoryCustomization(
	env: Env,
	storyKey: string,
	customName: string | null,
	customPronoun: string | null
): Promise<Response> {
	try {
		// Validate story exists
		const storyMeta = STORY_METADATA[storyKey as keyof typeof STORY_METADATA];
		if (!storyMeta) {
			return new Response(`Story "${storyKey}" not found`, {
				status: 404,
				headers: { 'Content-Type': 'text/plain' },
			});
		}

		// Validate pronoun
		const pronounKey = (customPronoun || 'he') as PronounKey;
		if (!PRONOUNS[pronounKey]) {
			return new Response(`Invalid pronoun "${customPronoun}". Use: he, she, or they`, {
				status: 400,
				headers: { 'Content-Type': 'text/plain' },
			});
		}

		// Fetch story content from static assets
		const storyFile = await fetch(`https://junothreadborne.me/books/${storyKey}.md`);
		if (!storyFile.ok) {
			return new Response('Story content not available', {
				status: 503,
				headers: { 'Content-Type': 'text/plain' },
			});
		}
		const storyMarkdown = await storyFile.text();
		const htmlBeforePronouns = markdownToHTML(storyMarkdown);

		let customizedHTML = htmlBeforePronouns;

		if (customName) {
			customizedHTML = rewritePronouns(customizedHTML, storyMeta.originalName, customName, pronounKey);
		} else if (pronounKey !== storyMeta.originalPronoun) {
			customizedHTML = rewritePronouns(customizedHTML, storyMeta.originalName, storyMeta.originalName, pronounKey);
		}

		// Create customization banner
		let bannerText = '';
		if (customName && pronounKey !== storyMeta.originalPronoun) {
			bannerText = `✨ Customized for ${customName} (${pronounKey}/${PRONOUNS[pronounKey].object})`;
		} else if (customName) {
			bannerText = `✨ Customized for ${customName}`;
		} else if (pronounKey !== storyMeta.originalPronoun) {
			bannerText = `✨ Using ${pronounKey}/${PRONOUNS[pronounKey].object} pronouns`;
		}

		const banner = bannerText ? `<div class="customization-banner">${bannerText}</div>` : '';

		// Build complete HTML
		const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${storyMeta.title}${customName ? ` - ${customName}'s Version` : ''}</title>
    <meta name="description" content="${storyMeta.description}">
    <meta property="og:title" content="${storyMeta.title}${customName ? ` - ${customName}'s Version` : ''}">
    <meta property="og:description" content="${storyMeta.description}">
    <meta property="og:type" content="article">
    <meta property="og:image" content="${storyMeta.image}">
    ${STORY_CSS}
</head>
<body>
    ${banner}
    <div class="story-container">
    <p class="text-xl md:text-2xl text-muted-foreground mb-6"><img src="${storyMeta.image}" alt="${
			storyMeta.title
		}" class="w-full mb-4 rounded-lg shadow-lg"></p>
        ${customizedHTML}
    </div>

    <script>
      window.storyTitle = "${storyMeta.title}";
      window.customizedFor = "${customName || ''}";

      // You can add your StoryScrollTracker component here
      // or load it from your CDN/assets
    </script>
</body>
</html>`;

		return new Response(fullHTML, {
			headers: {
				'Content-Type': 'text/html;charset=UTF-8',
				'Cache-Control': 'public, max-age=3600',
				'Access-Control-Allow-Origin': '*',
			},
		});
	} catch (error) {
		console.error('Story customization error:', error);
		return new Response('Internal Server Error', {
			status: 500,
			headers: { 'Content-Type': 'text/plain' },
		});
	}
}

interface Env {
	LINKS: KVNamespace;
	API_KEY: string;
	ASSETS: Fetcher;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;

		// === Handle CORS preflight ===
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, Authorization',
				},
			});
		}

		// === GET /api/all → list all KV entries ===
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

		// === Story customization: /in/to/:story ===
		if (pathname.startsWith('/in/to/')) {
			const storyPath = pathname.replace('/in/to/', '');
			const customName = url.searchParams.get('n');
			const customPronoun = url.searchParams.get('p');

			return handleStoryCustomization(env, storyPath, customName, customPronoun);
		}

		// === Link redirect: /to/:slug ===
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

		// === POST /shorten → add new slug (auth-protected) ===
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

		// === Fallback ===
		return new Response('Not Found.', { status: 404 });
	},
};
