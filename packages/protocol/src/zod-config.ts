import { z } from "zod";

// Never compile validators with eval / new Function: the site's Content-Security-Policy forbids eval.
// Imported first by every schema module, because imports run before the importing module's own code.
z.config({ jitless: true });
