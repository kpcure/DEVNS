import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

type JsonSchema = object;

export type SchemaValidationResult =
  | {
      valid: true;
      errors: [];
    }
  | {
      valid: false;
      errors: string[];
    };

export function validateSchema(value: unknown, schema: JsonSchema): SchemaValidationResult {
  const ajv = addFormats(
    new Ajv2020({
      allErrors: true,
      allowUnionTypes: true,
      strict: false
    })
  );
  const validate = ajv.compile(schema);
  if (validate(value)) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: (validate.errors ?? []).map((error) => {
      const location = error.instancePath || "$";
      return `${location} ${error.message ?? "failed schema validation"}`;
    })
  };
}
