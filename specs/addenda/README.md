# specs/addenda/ — category-specific security addenda

These files extend the canonical security block (`specs/security_block.md`) for
specific categories of specification. They are part of the **variant-B** prompt only.

## Rules

- An addendum **extends, never replaces** the canonical block. A variant-B prompt's
  security instruction is: `security_block.md` + (any addenda for the spec's category),
  in that order.
- Addenda are applied **deterministically by category** via `addenda_map.json`,
  whose keys must match the `category` values in `specs/catalog.json` exactly.
- Every spec within a category receives the **identical** addenda, so the security
  instruction stays constant across all specs in that category and across both tools.
- A category with no mapping entry receives the canonical block only.

## Current addenda

| File | Applies to (example categories) | Adds |
| --- | --- | --- |
| `upload-hardening.md` | `file-handling`, `file-upload` | type allow-list (by content), size limit, safe random stored names, no path traversal |
| `ssrf.md` | `external-integration` | scheme allow-list; block private/loopback/link-local + cloud-metadata ranges; timeouts and response-size limit; no redirects to disallowed targets |

Add a new addendum by dropping a `.md` file here and referencing it from
`addenda_map.json` under the relevant category key(s).
