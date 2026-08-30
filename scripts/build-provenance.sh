#!/usr/bin/env bash

# Gemeinsame Ermittlung der Build-Version für Git-Checkouts und mit
# `git archive` übertragene Installationen. Diese Datei wird nur eingebunden.

solooffice_project_version() {
    local project_root="$1"
    local version

    version=$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
        "$project_root/package.json" | head -n 1)
    if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
        printf 'dev\n'
        return
    fi
    printf '%s\n' "$version"
}

solooffice_source_revision() {
    local project_root="$1"
    local revision=""

    if git -C "$project_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        if [ -z "$(git -C "$project_root" status --porcelain --untracked-files=normal)" ]; then
            revision=$(git -C "$project_root" rev-parse --verify HEAD 2>/dev/null || true)
        fi
    elif [ -f "$project_root/BUILD_COMMIT" ]; then
        revision=$(tr -d '[:space:]' < "$project_root/BUILD_COMMIT")
    fi

    if [[ "$revision" =~ ^[0-9a-f]{40}$ ]]; then
        printf '%s\n' "$revision"
    else
        printf 'unknown\n'
    fi
}

solooffice_require_revision() {
    local revision="$1"
    if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
        printf 'Der Quellstand besitzt keinen eindeutigen 40-stelligen Commit-Nachweis.\n' >&2
        return 1
    fi
}

solooffice_write_sha256_manifest() {
    local manifest="$1"
    shift

    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$@" > "$manifest"
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$@" > "$manifest"
    else
        printf 'Weder sha256sum noch shasum ist verfügbar.\n' >&2
        return 1
    fi
}

solooffice_verify_sha256_manifest() {
    local manifest="$1"

    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum -c "$manifest"
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 -c "$manifest"
    else
        printf 'Weder sha256sum noch shasum ist verfügbar.\n' >&2
        return 1
    fi
}
