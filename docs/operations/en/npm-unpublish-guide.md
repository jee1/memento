# npm unpublish guide

npm limits how long you can **remove a published package or version**—usually within **72 hours** of publish, and only if nothing else depends on that version. Use this when a bad release must be pulled before users pin it.

**Rules:** unpublish works only inside the 72h window; dependent packages block removal; after 72h you need npm support. Prefer **deprecate** or publish a fixed patch instead of unpublish when possible.

Full steps and examples (KO): [npm-unpublish-guide.md (KO)](../ko/npm-unpublish-guide.md).

## Unpublish one version

```bash
npm unpublish <package>@<version>
```

Example: `npm unpublish memento-mcp-server@1.6.0`

You must be logged in (`npm login`) and own the package. Always confirm dependents on npm before unpublishing.
