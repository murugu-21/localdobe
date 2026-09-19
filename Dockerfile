# syntax=docker/dockerfile:1
#
# Builds the static site with Bun, then serves dist/ with nginx.
#
#   docker build -t localdobe .
#   docker run --rm -p 8080:80 localdobe        # http://localhost:8080/
#
# Set SITE_URL so canonical, sitemap and Open Graph URLs point at your host:
#   docker build --build-arg SITE_URL=https://pdf.example.com -t localdobe .
#
# The WebAssembly engines and the orientation model are stored in Git LFS.
# Clone with `git lfs install` first; the build fails on a pointer-only checkout.

FROM oven/bun:1.3 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Refuse to build from Git LFS pointer files (a few hundred bytes each).
RUN set -e; for f in public/wasm/pdfcpu-v4.wasm public/models/doc-ori.onnx public/wasm/ort/ort-wasm-simd-threaded.wasm; do \
      if [ "$(stat -c %s "$f")" -lt 100000 ]; then \
        echo "ERROR: $f is a Git LFS pointer, not the real file. Run 'git lfs install && git lfs pull' and rebuild." >&2; exit 1; \
      fi; \
    done

ARG SITE_URL=https://localdobe.com
ENV SITE_URL=$SITE_URL
RUN bun run build

FROM nginx:1.29-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
