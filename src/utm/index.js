/**
 * Forms to Odoo: remembers where the visitor came from, for the Source,
 * Medium and Campaign of the records their form submissions create.
 *
 * - A link with utm_source, utm_medium or utm_campaign tags: kept, and
 *   replaced by the next tagged link (the latest campaign wins).
 * - Otherwise, the first visit from another website: its name as source
 *   (Google, Facebook, or the domain, e.g. example.org), with medium
 *   "organic" (search engines), "social" or "referral", unless tags were
 *   already kept.
 *
 * Kept 90 days in this browser only, and added to every Contact Form 7
 * form on the page as the hidden _fto_utm field.
 */
const KEY = 'fto_utm';
const MAX_AGE = 90 * 24 * 60 * 60 * 1000;
// Well-known sites, by a domain label: [name, medium]. The names match
// Odoo's own sources (e.g. its default "Facebook" and "LinkedIn"), so
// existing ones are reused instead of creating "facebook.com" next to them.
const KNOWN = {
	google: [ 'Google', 'organic' ],
	bing: [ 'Bing', 'organic' ],
	duckduckgo: [ 'DuckDuckGo', 'organic' ],
	yahoo: [ 'Yahoo', 'organic' ],
	ecosia: [ 'Ecosia', 'organic' ],
	qwant: [ 'Qwant', 'organic' ],
	baidu: [ 'Baidu', 'organic' ],
	yandex: [ 'Yandex', 'organic' ],
	startpage: [ 'Startpage', 'organic' ],
	brave: [ 'Brave Search', 'organic' ],
	facebook: [ 'Facebook', 'social' ],
	instagram: [ 'Instagram', 'social' ],
	linkedin: [ 'LinkedIn', 'social' ],
	lnkd: [ 'LinkedIn', 'social' ],
	twitter: [ 'X', 'social' ],
	x: [ 'X', 'social' ],
	t: [ 'X', 'social' ], // t.co
	youtube: [ 'YouTube', 'social' ],
	pinterest: [ 'Pinterest', 'social' ],
	tiktok: [ 'TikTok', 'social' ],
	reddit: [ 'Reddit', 'social' ],
};

// [source, medium] for a referring host, e.g. "www.google.be" → Google.
// Only the site's own name counts: "google" in google.co.uk or
// l.facebook.com, not in google.example.com.
function fromHost( host ) {
	const labels = host.split( '.' );
	let name = labels[ labels.length - 2 ] || '';
	// two-part endings: google.co.uk, google.com.au
	if (
		labels.length > 2 &&
		[ 'co', 'com', 'org', 'net', 'ac', 'gov', 'edu' ].includes( name )
	) {
		name = labels[ labels.length - 3 ];
	}
	return KNOWN[ name ] || [ host, 'referral' ];
}

function read() {
	try {
		const saved = JSON.parse( window.localStorage.getItem( KEY ) );
		return saved && Date.now() - saved.at < MAX_AGE ? saved : null;
	} catch {
		return null;
	}
}

function save( source ) {
	try {
		window.localStorage.setItem(
			KEY,
			JSON.stringify( { ...source, at: Date.now() } )
		);
	} catch {
		// storage blocked (private mode, settings): nothing is kept
	}
}

const bare = ( host ) => host.replace( /^www\./, '' );

function capture() {
	const params = new URLSearchParams( window.location.search );
	const tags = {
		source: params.get( 'utm_source' ) || '',
		medium: params.get( 'utm_medium' ) || '',
		campaign: params.get( 'utm_campaign' ) || '',
	};
	const landing = window.location.href.split( '#' )[ 0 ];
	const referrer = document.referrer;

	if ( tags.source || tags.medium || tags.campaign ) {
		save( { ...tags, via: 'utm', landing, referrer } );
		return;
	}
	if ( ! referrer || read() ) {
		return;
	}
	let host = '';
	try {
		host = bare( new URL( referrer ).hostname );
	} catch {
		return;
	}
	if ( host && host !== bare( window.location.hostname ) ) {
		const [ source, medium ] = fromHost( host );
		save( {
			source,
			medium,
			campaign: '',
			via: 'referrer',
			landing,
			referrer,
		} );
	}
}

function addToForms() {
	const source = read();
	if ( ! source ) {
		return;
	}
	const { at, ...data } = source;
	document.querySelectorAll( 'form.wpcf7-form' ).forEach( ( form ) => {
		let input = form.querySelector( 'input[name="_fto_utm"]' );
		if ( ! input ) {
			input = document.createElement( 'input' );
			input.type = 'hidden';
			input.name = '_fto_utm';
			form.appendChild( input );
		}
		input.value = JSON.stringify( data );
	} );
}

capture();
if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', addToForms );
} else {
	addToForms();
}
