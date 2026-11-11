# CI image builds. Used with the compose files, which supply each image's build
# context and Dockerfile; this file adds the GHCR tags, the source label and the
# GitHub Actions layer cache. See .github/workflows/ci.yml.
#
#   docker buildx bake -f compose.yaml -f wordpress/compose.yaml \
#     -f apps/web/compose.yaml -f apps/worker/compose.yaml \
#     -f infra/images.compose.yaml -f infra/docker-bake.hcl web wordpress worker

variable "REGISTRY" {
  default = "ghcr.io/thuane3691"
}

# Extra tag next to "latest"; CI passes the commit SHA.
variable "TAG" {
  default = "dev"
}

variable "SOURCE_URL" {
  default = "https://github.com/ThuanE3691/AppShelf"
}

function "image_tags" {
  params = [name]
  result = ["${REGISTRY}/appshelf-${name}:latest", "${REGISTRY}/appshelf-${name}:${TAG}"]
}

target "_common" {
  labels = {
    "org.opencontainers.image.source"      = SOURCE_URL
    "org.opencontainers.image.description" = "AppShelf personal demo project (Stripe test mode only)"
    "org.opencontainers.image.revision"    = TAG
  }
}

target "web" {
  inherits   = ["_common"]
  tags       = image_tags("web")
  cache-from = ["type=gha,scope=web"]
  cache-to   = ["type=gha,scope=web,mode=max"]
}

target "wordpress" {
  inherits   = ["_common"]
  tags       = image_tags("wordpress")
  cache-from = ["type=gha,scope=wordpress"]
  cache-to   = ["type=gha,scope=wordpress,mode=max"]
}

target "worker" {
  inherits   = ["_common"]
  tags       = image_tags("worker")
  cache-from = ["type=gha,scope=worker"]
  cache-to   = ["type=gha,scope=worker,mode=max"]
}
