type JsonSchema = {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  minItems?: number;
  additionalProperties?: boolean | JsonSchema;
};

export type SchemaValidationResult =
  | {
      valid: true;
      errors: [];
    }
  | {
      valid: false;
      errors: string[];
    };

function typeOf(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function matchesType(value: unknown, expected: string) {
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "object") return typeOf(value) === "object";
  return typeOf(value) === expected;
}

function formatPath(path: string) {
  return path || "$";
}

function validateNode(value: unknown, schema: JsonSchema, path: string, errors: string[]) {
  if (schema.type) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expectedTypes.some((expected) => matchesType(value, expected))) {
      errors.push(`${formatPath(path)} expected ${expectedTypes.join(" or ")}, got ${typeOf(value)}`);
      return;
    }
  }

  if (schema.enum && !schema.enum.some((item) => item === value)) {
    errors.push(`${formatPath(path)} must be one of ${schema.enum.map(String).join(", ")}`);
  }

  if (schema.type === "array" && Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${formatPath(path)} must contain at least ${schema.minItems} item(s)`);
    }

    if (schema.items) {
      value.forEach((item, index) => validateNode(item, schema.items as JsonSchema, `${path}[${index}]`, errors));
    }
  }

  if (schema.type === "object" && value && typeOf(value) === "object") {
    const objectValue = value as Record<string, unknown>;
    const properties = schema.properties ?? {};

    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in objectValue)) {
        errors.push(`${formatPath(path)} is missing required property ${requiredKey}`);
      }
    }

    for (const [key, childValue] of Object.entries(objectValue)) {
      const childSchema = properties[key];
      if (childSchema) {
        validateNode(childValue, childSchema, path ? `${path}.${key}` : key, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${formatPath(path)} has unknown property ${key}`);
      } else if (typeof schema.additionalProperties === "object") {
        validateNode(childValue, schema.additionalProperties, path ? `${path}.${key}` : key, errors);
      }
    }
  }
}

export function validateSchema(value: unknown, schema: JsonSchema): SchemaValidationResult {
  const errors: string[] = [];
  validateNode(value, schema, "", errors);
  return errors.length ? { valid: false, errors } : { valid: true, errors: [] };
}
