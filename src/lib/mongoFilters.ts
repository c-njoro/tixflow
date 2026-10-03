// src/lib/mongoFilters.ts
//
// MongoDB quirk: documents saved before a field was added to the schema
// don't have the field at all. Reads still see the @default value, but
// `where` clauses only match what's actually stored.

// Optional fields: matches null OR never set.
export const notSet = (field: string) => ({ OR: [{ [field]: null }, { [field]: { isSet: false } }] });
