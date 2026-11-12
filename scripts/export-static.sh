#!/usr/bin/env bash
# Export static snapshots of the three AppShelf template showcase sites
# (/restaurant-demo/, /agency-demo/, /services-demo/) from a running WordPress
# Multisite, ready to serve from GitHub Pages under a base path.
#
# Usage:
#   WP_ORIGIN=http://127.0.0.1:8089 [LANDING_DIR=showcase] scripts/export-static.sh <out-dir>
#   scripts/export-static.sh --check http://127.0.0.1:8000/AppShelf/
#
# The second form crawls a served build from the given URL and fails on any
# internal page, asset or link that does not answer 200 (redirects included)
# or that points outside the start path. CHECK_EXTERNAL=1 also requests every
# external link once.
#
# Environment:
#   WP_ORIGIN  where WordPress answers HTTP (required), e.g. http://127.0.0.1:8089
#   WP_DOMAIN  the network domain WordPress was installed with; sent as the Host
#              header (default wp.appshelf.localhost, as in wordpress/compose.yaml)
#   BASE_PATH  path the site is served under (default /AppShelf)
#   SITE_URL   public URL of BASE_PATH, used for canonical links
#              (default https://thuane3691.github.io/AppShelf)
#   SLUGS      showcase sites to export (default "restaurant-demo agency-demo services-demo")
#   LANDING_DIR  optional folder copied to the root of <out-dir> (the landing
#              page). Its index.html shows the demo video block when
#              media/appshelf-demo.mp4 exists there, else the placeholder block.
#
# Each site lands in <out-dir>/<slug>/ with its pages as <path>/index.html and
# every asset it uses under <slug>/wp-content/ or <slug>/wp-includes/.
# Fails if any page or asset does not return 200, or if a link to the WordPress
# domain or a root path outside BASE_PATH remains.
set -euo pipefail

# Crawl a served build (see usage above). Python 3 standard library only.
check_site() {
	local py
	py=${PYTHON:-$(command -v python3 || command -v python || true)}
	[ -n "$py" ] || { echo "export-static: ERROR: python3 is required for --check" >&2; exit 1; }
	"$py" - "$1" <<'PY'
import os, re, sys, urllib.error, urllib.parse, urllib.request
from html.parser import HTMLParser

start = sys.argv[1] if sys.argv[1].endswith("/") else sys.argv[1] + "/"
origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(start))
base = urllib.parse.urlsplit(start).path
SKIP = ("mailto:", "tel:", "data:", "javascript:")
CSS_URL = re.compile(r"""url\(\s*['"]?([^'")]+)""")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

opener = urllib.request.build_opener(NoRedirect)

def get(url, method="GET"):
    req = urllib.request.Request(url, method=method, headers={"User-Agent": "appshelf-link-check"})
    try:
        with opener.open(req, timeout=20) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read() if method == "GET" else b""
    except urllib.error.HTTPError as e:
        return e.code, "", b""
    except Exception as e:  # network errors
        return str(e), "", b""

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links, self.styles, self._in_style = [], [], False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "style":
            self._in_style = True
        if tag == "link" and "canonical" in (a.get("rel") or "").split():
            return  # points at the public URL, not at this server
        for name in ("href", "src", "poster"):
            if a.get(name):
                self.links.append(a[name])
        if a.get("srcset"):
            self.links += [part.strip().split()[0] for part in a["srcset"].split(",") if part.strip()]
        if a.get("style"):
            self.styles.append(a["style"])
    def handle_endtag(self, tag):
        if tag == "style":
            self._in_style = False
    def handle_data(self, data):
        if self._in_style:
            self.styles.append(data)

queue, seen, external, failures = [(start, "(start)")], set(), {}, []
while queue:
    url, ref = queue.pop(0)
    if url in seen:
        continue
    seen.add(url)
    status, ctype, body = get(url)
    if status != 200:
        failures.append(f"{status}  {url}  (linked from {ref})")
        continue
    found = []
    if "text/html" in ctype:
        p = Links()
        p.feed(body.decode("utf-8", "replace"))
        found = p.links + [m for s in p.styles for m in CSS_URL.findall(s)]
    elif "text/css" in ctype:
        found = CSS_URL.findall(body.decode("utf-8", "replace"))
    for link in found:
        link = link.strip()
        if not link or link.startswith("#") or link.lower().startswith(SKIP):
            continue
        target = urllib.parse.urldefrag(urllib.parse.urljoin(url, link))[0]
        if target.startswith(origin + "/") or target == origin:
            if not urllib.parse.urlsplit(target).path.startswith(base):
                failures.append(f"outside {base}  {target}  (linked from {url})")
            elif target not in seen:
                queue.append((target, url))
        else:
            external.setdefault(target, url)

print(f"link check: {len(seen)} internal URLs, {len(external)} external links")
if os.environ.get("CHECK_EXTERNAL") == "1":
    for target, ref in sorted(external.items()):
        status = get(target, "HEAD")[0]
        if status in (405, 403):
            status = get(target)[0]
        if status == 429:
            print(f"  rate limited, not counted: {target}")
        elif not (isinstance(status, int) and status < 400):
            failures.append(f"{status}  {target}  (external, linked from {ref})")
else:
    for target in sorted(external):
        print(f"  external, not requested: {target}")
for f in failures:
    print("  BROKEN " + f)
sys.exit(1 if failures else 0)
PY
}

if [ "${1:-}" = "--check" ]; then
	check_site "${2:?usage: $0 --check <served-url>}"
	exit
fi

out=${1:?usage: WP_ORIGIN=http://host:port $0 <out-dir>}
WP_ORIGIN=${WP_ORIGIN:?WP_ORIGIN is not set (where WordPress answers, e.g. http://127.0.0.1:8089)}
WP_ORIGIN=${WP_ORIGIN%/}
WP_DOMAIN=${WP_DOMAIN:-wp.appshelf.localhost}
BASE_PATH=${BASE_PATH:-/AppShelf}
BASE_PATH=/${BASE_PATH#/}
BASE_PATH=${BASE_PATH%/}
SITE_URL=${SITE_URL:-https://thuane3691.github.io/AppShelf}
SITE_URL=${SITE_URL%/}
SLUGS=${SLUGS:-restaurant-demo agency-demo services-demo}
NOTE='Static snapshot of an AppShelf WordPress template · live provisioning demo on request'
WP_DOMAIN_RE=$(printf '%s' "$WP_DOMAIN" | sed 's/[.]/\\./g')

log() { printf 'export-static: %s\n' "$*" >&2; }
die() { printf 'export-static: ERROR: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null || die "curl is required"
command -v perl >/dev/null || die "perl is required"

# Fetch one path from WordPress into a file; anything but 200 is fatal
# (a redirect means a link points somewhere the snapshot cannot follow).
fetch() {
	local path=$1 dest=$2 code
	mkdir -p "$(dirname "$dest")"
	code=$(curl -sS -o "$dest" -w '%{http_code}' -H "Host: $WP_DOMAIN" "$WP_ORIGIN$path") ||
		die "request failed: $path"
	[ "$code" = 200 ] || die "HTTP $code for $path"
}

# Drop what only works on a live WordPress, before links are collected:
# feed/REST/oEmbed/RSD/pingback/shortlink head links, speculative prefetch rules
# (they target WordPress paths), forms (nothing can POST on a static host),
# sourceURL comments and
# links to login, admin, feeds and other WordPress endpoints (kept as text).
clean_html() {
	DOMAIN_RE=$WP_DOMAIN_RE perl -0pi -e '
		my $dom = $ENV{DOMAIN_RE};
		s{<link\b[^>]*\brel=["\x27](?:alternate|https://api\.w\.org/|EditURI|pingback|shortlink|wlwmanifest)["\x27][^>]*>\s*}{}gi;
		s{<script\b[^>]*type=["\x27]speculationrules["\x27][^>]*>.*?</script>\s*}{}gis;
		s{<form\b.*?</form>\s*}{}gis;
		# Debug comments in inline styles name stylesheets the page never loads.
		s{\s*/\*# sourceURL=[^*]*\*/}{}g;
		s{<a\b[^>]*\bhref=["\x27](?:https?://$dom)?/(?:[a-z0-9-]+/)?(?:wp-login\.php|wp-admin/|wp-json/|xmlrpc\.php|feed/|comments/feed/|wp-signup\.php|wp-activate\.php)[^"\x27]*["\x27][^>]*>(.*?)</a>}{$1}gis;
	' "$1"
}

# Rewrite one page or stylesheet of site $2 for the static host.
rewrite_file() {
	SLUG=$2 BASE=$BASE_PATH SITE_URL=$SITE_URL DOMAIN_RE=$WP_DOMAIN_RE NOTE=$NOTE perl -0pi -e '
		my ($slug, $base, $site, $dom, $note) = @ENV{qw(SLUG BASE SITE_URL DOMAIN_RE NOTE)};
		my $is_html = $ARGV =~ /\.html$/;
		# Canonical links point at the public snapshot.
		s{(<link\b[^>]*rel=["\x27]canonical["\x27][^>]*href=["\x27])(?:https?://$dom)?/}{$1$site/}gi if $is_html;
		# Assets: any site prefix collapses to <base>/<slug>/wp-(content|includes)/.
		s{(?:https?://$dom)?/(?:[a-z0-9-]+/)?(wp-(?:content|includes)/)}{$base/$slug/$1}g;
		# Absolute links to the site, with or without the trailing slash.
		s{https?://$dom/\Q$slug\E(?=["\x27/])}{$base/$slug}g;
		s{(["\x27])$base/\Q$slug\E\1}{$1$base/$slug/$1}g;
		# Root-relative links into the site.
		s{(["\x27(])/\Q$slug\E/}{$1$base/$slug/}g;
		if ($is_html) {
			# The note goes in the demo banner the network mu-plugin prints at the top of every page.
			my $link = qq{<a href="$base/" style="color:inherit;text-decoration:underline;text-underline-offset:2px">$note</a>};
			s{(<div class="appshelf-demo-banner"[^>]*>).*?(</div>)}{$1$link$2}s
				or s{(<body\b[^>]*>)}{$1<div class="appshelf-demo-banner" role="note" style="margin:0;padding:8px 16px;background:#111;color:#fff;font:500 14px/1.45 system-ui,sans-serif;text-align:center">$link</div>}
				or die "no <body> in $ARGV\n";
		}
	' "$1"
}

# Root-relative paths of WordPress assets referenced in a file (HTML or CSS),
# absolute URLs on the WP domain included. Query strings and fragments dropped.
asset_paths() {
	{ grep -oE "(https?://$WP_DOMAIN_RE)?/([a-z0-9-]+/)?wp-(content|includes)/[^\"' )?#,]+" "$1" || true; } |
		sed -E "s#^https?://$WP_DOMAIN_RE##" | sort -u
}

# url(...) references inside a CSS file, resolved against the CSS file's URL directory.
css_relative_paths() {
	local css=$1 dir=$2
	{ grep -oE "url\(['\"]?[^'\")]+" "$css" || true; } | sed -E "s/^url\(['\"]?//" |
		{ grep -vE '^(data:|https?:|/|#)' || true; } | sed -E 's/[?#].*$//' |
		while read -r rel; do
			perl -e '@p=(); for (split m{/}, $ARGV[0]) { if ($_ eq "..") { pop @p } elsif ($_ ne "." && $_ ne "") { push @p, $_ } } print "/", join("/", @p), "\n"' "$dir/$rel"
		done | sort -u
}

# Page paths (inside site $2) linked from an HTML file.
page_links() {
	{ grep -oE "href=\"(https?://$WP_DOMAIN_RE)?/$2(/[^\"#?]*)?\"" "$1" || true; } |
		sed -E "s#^href=\"(https?://$WP_DOMAIN_RE)?##; s#\"\$##" |
		{ grep -vE "/(wp-[a-z-]+|feed|comments|xmlrpc\.php|trackback|embed)(/|\$)|\.php\$" || true; } |
		sed -E 's#/?$#/#' | sort -u
}

rm -rf "$out"
mkdir -p "$out"

for slug in $SLUGS; do
	site="$out/$slug"
	log "mirroring /$slug/"
	unset seen_pages seen_assets
	declare -A seen_pages=() seen_assets=()
	queue=("/$slug/")
	pages=()
	while [ "${#queue[@]}" -gt 0 ]; do
		path=${queue[0]}
		queue=("${queue[@]:1}")
		[ -z "${seen_pages[$path]:-}" ] || continue
		seen_pages[$path]=1
		dest="$out${path}index.html"
		fetch "$path" "$dest"
		clean_html "$dest"
		pages+=("$dest")
		while read -r link; do
			if [ -n "$link" ] && [ -z "${seen_pages[$link]:-}" ]; then queue+=("$link"); fi
		done < <(page_links "$dest" "$slug")
	done
	log "  ${#pages[@]} pages"

	# Assets: everything under wp-content/ or wp-includes/ that a page or a
	# stylesheet uses, saved under <slug>/ whatever site prefix the URL had.
	assets=()
	for page in "${pages[@]}"; do
		while read -r a; do if [ -n "$a" ]; then assets+=("$a"); fi; done < <(asset_paths "$page")
	done
	i=0
	while [ "$i" -lt "${#assets[@]}" ]; do
		a=${assets[$i]}
		i=$((i + 1))
		[ -z "${seen_assets[$a]:-}" ] || continue
		seen_assets[$a]=1
		dest="$site$(printf '%s' "$a" | sed -E 's#^/([a-z0-9-]+/)?(wp-(content|includes)/)#/\2#')"
		fetch "$a" "$dest"
		case "$dest" in
		*.css)
			while read -r r; do if [ -n "$r" ]; then assets+=("$r"); fi; done < <(asset_paths "$dest")
			while read -r r; do if [ -n "$r" ]; then assets+=("$r"); fi; done < <(css_relative_paths "$dest" "$(dirname "$a")")
			;;
		esac
	done
	log "  ${#seen_assets[@]} assets"

	while IFS= read -r -d '' file; do
		rewrite_file "$file" "$slug"
	done < <(find "$site" -type f \( -name '*.html' -o -name '*.css' \) -print0)
done

if [ -n "${LANDING_DIR:-}" ]; then
	[ -f "$LANDING_DIR/index.html" ] || die "no index.html in LANDING_DIR=$LANDING_DIR"
	log "adding the landing page from $LANDING_DIR"
	cp -R "$LANDING_DIR"/. "$out"/
	if [ -f "$LANDING_DIR/media/appshelf-demo.mp4" ]; then
		drop=demo-video-placeholder
	else
		drop=demo-video
		log "  media/appshelf-demo.mp4 not found: showing the video placeholder"
	fi
	DROP=$drop perl -0pi -e '
		my $d = $ENV{DROP};
		s{[ \t]*<!-- \Q$d\E:start -->.*?<!-- \Q$d\E:end -->\n?}{}s or die "no $d block in index.html\n";
		s{[ \t]*<!-- demo-video(?:-placeholder)?:(?:start|end) -->\n?}{}g;
	' "$out/index.html"
	if [ "$drop" = demo-video-placeholder ] && [ ! -f "$LANDING_DIR/media/appshelf-demo-poster.png" ]; then
		perl -pi -e 's{ poster="media/appshelf-demo-poster\.png"}{}' "$out/index.html"
	fi
fi

log "checking the output"
leftovers=$(grep -rlE "https?://$WP_DOMAIN_RE" "$out" || true)
[ -z "$leftovers" ] || die "links to $WP_DOMAIN remain in:"$'\n'"$leftovers"
# Every root-relative href/src/srcset/action/url() must stay under BASE_PATH.
outside=$({ grep -rhoE "(href|src|srcset|action)=[\"']/[^\"']*|url\(['\"]?/[^)]*" "$out" --include='*.html' --include='*.css' || true; } |
	{ grep -vE "(=[\"']|url\(['\"]?)$BASE_PATH/" || true; } | sort -u)
[ -z "$outside" ] || die "root paths outside $BASE_PATH remain:"$'\n'"$outside"
for slug in $SLUGS; do
	missing=$(grep -rLF "$NOTE" "$out/$slug" --include='*.html' || true)
	[ -z "$missing" ] || die "pages without the snapshot note:"$'\n'"$missing"
	if grep -rqiE "<form\b|speculationrules|(href|src|action)=[\"'][^\"']*(wp-json|xmlrpc|wp-login|wp-admin/|/feed/|oembed)" "$out/$slug" --include='*.html'; then
		die "WordPress endpoints or forms remain in $slug"
	fi
done
log "done: $(find "$out" -name index.html | wc -l) pages in $out"
