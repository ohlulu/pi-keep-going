/**
 * Resolve hook so dev scripts can import `src/` directly.
 *
 * The extension uses extensionless relative imports (`./sprite`) because pi's
 * loader resolves them. Plain Node ESM does not, so retry with `.ts` rather
 * than reshaping production imports to suit dev tooling.
 */

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      return next(`${specifier}.ts`, context);
    }
    throw error;
  }
}
