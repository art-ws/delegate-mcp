import { z } from "zod";

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };
export type StructuredValue = string | JsonObject | JsonValue[];

// Direct module calls must obey JSON-only too. Do not stringify: that can coerce
// undefined, non-finite numbers and sparse arrays instead of rejecting them.
function isJson(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return false;
  ancestors.add(value);
  const keys = Reflect.ownKeys(value).filter((key) => !(Array.isArray(value) && key === "length"));
  const valid = (!Array.isArray(value) || keys.length === value.length) && keys.every((key, index) => {
    if (typeof key !== "string" || (Array.isArray(value) && key !== String(index))) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor && isJson(descriptor.value, ancestors);
  });
  ancestors.delete(value);
  return valid;
}

const jsonValueSchema = z.custom<JsonValue>((value) => isJson(value));
const jsonObjectSchema = z.custom<JsonObject>((value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && isJson(value),
);
const structuredSchema = z.union([z.string(), jsonObjectSchema, z.array(jsonValueSchema)]);

// Validate a map in place so arbitrary JSON keys, including __proto__, survive.
function jsonRecord<T>(itemSchema: z.ZodType<T>): z.ZodType<Record<string, T>> {
  return z.custom<Record<string, T>>((value) =>
    jsonObjectSchema.safeParse(value).success &&
    Object.values(value as JsonObject).every((item) => itemSchema.safeParse(item).success),
  );
}

const codePointString = (max: number) => z.string().refine((value) => [...value].length <= max);
const probabilitySchema = z.number().min(0).max(1);

// Zod deliberately skips __proto__ while constructing parsed objects. Check
// original keys first so unknown contract fields cannot disappear before strictness.
function strictObject<T extends z.ZodRawShape>(shape: T) {
  return z.preprocess((value, ctx) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value) &&
        Object.keys(value).some((key) => !Object.hasOwn(shape, key))) {
      ctx.addIssue({ code: "custom", message: "Unknown contract field." });
    }
    return value;
  }, z.strictObject(shape));
}


// SPEC v0.2 runtime declarations, embedded from the canonical schemas.
// Attribution and source hashes: docs/decision/sources.json and tasks/baseline.json.
// No runtime filesystem access; shared definitions are identical in both canons.
const sharedDefinitions = {
  "ProviderPreferences": {
    "additionalProperties": false,
    "properties": {
      "allow_fallbacks": {
        "type": [
          "boolean",
          "null"
        ]
      },
      "data_collection": {
        "enum": [
          "deny",
          "allow",
          null
        ],
        "type": [
          "string",
          "null"
        ]
      },
      "enforce_distillable_text": {
        "type": [
          "boolean",
          "null"
        ]
      },
      "ignore": {
        "items": {
          "type": "string"
        },
        "type": [
          "array",
          "null"
        ]
      },
      "max_price": {
        "properties": {
          "audio": {
            "type": "string"
          },
          "completion": {
            "type": "string"
          },
          "image": {
            "type": "string"
          },
          "prompt": {
            "type": "string"
          },
          "request": {
            "type": "string"
          }
        },
        "type": "object",
        "additionalProperties": false
      },
      "only": {
        "items": {
          "type": "string"
        },
        "type": [
          "array",
          "null"
        ]
      },
      "options": {
        "$ref": "#/$defs/ProviderOptions"
      },
      "order": {
        "items": {
          "type": "string"
        },
        "type": [
          "array",
          "null"
        ]
      },
      "preferred_max_latency": {
        "$ref": "#/$defs/PreferredMaxLatency"
      },
      "preferred_min_throughput": {
        "$ref": "#/$defs/PreferredMinThroughput"
      },
      "quantizations": {
        "items": {
          "$ref": "#/$defs/Quantization"
        },
        "type": [
          "array",
          "null"
        ]
      },
      "require_parameters": {
        "type": [
          "boolean",
          "null"
        ]
      },
      "sort": {
        "anyOf": [
          {
            "$ref": "#/$defs/ProviderSort"
          },
          {
            "$ref": "#/$defs/ProviderSortConfig"
          },
          {
            "type": "null"
          }
        ]
      },
      "zdr": {
        "type": [
          "boolean",
          "null"
        ]
      }
    },
    "type": [
      "object",
      "null"
    ]
  },
  "ProviderOptions": {
    "type": "object",
    "propertyNames": {
      "enum": [
        "01ai",
        "ai21",
        "aion-labs",
        "akashml",
        "alibaba",
        "amazon-bedrock",
        "amazon-bedrock/claude-on-aws",
        "amazon-nova",
        "ambient",
        "anthropic",
        "anthropic/2",
        "anyscale",
        "arcee-ai",
        "assemblyai",
        "atlas-cloud",
        "atoma",
        "avian",
        "azure",
        "baidu",
        "baseten",
        "black-forest-labs",
        "byteplus",
        "centml",
        "cerebras",
        "chutes",
        "cirrascale",
        "clarifai",
        "claude-on-aws",
        "cloudflare",
        "cohere",
        "coreweave",
        "cosine",
        "crofai",
        "crucible",
        "crusoe",
        "darkbloom",
        "databricks",
        "decart",
        "deepgram",
        "deepinfra",
        "deepseek",
        "dekallm",
        "digitalocean",
        "elevenlabs",
        "enfer",
        "fake-provider",
        "featherless",
        "fireworks",
        "fish-audio",
        "friendli",
        "gmicloud",
        "google-ai-studio",
        "google-vertex",
        "gopomelo",
        "groq",
        "heygen",
        "huggingface",
        "hyperbolic",
        "hyperbolic-quantized",
        "inception",
        "inceptron",
        "inferact-vllm",
        "inference-net",
        "infermatic",
        "inflection",
        "inocloud",
        "io-net",
        "ionstream",
        "klusterai",
        "krea",
        "lambda",
        "lepton",
        "liquid",
        "lynn",
        "lynn-private",
        "makora",
        "mancer",
        "mancer-old",
        "mara",
        "meta",
        "minimax",
        "mistral",
        "modal",
        "modelrun",
        "modular",
        "moonshotai",
        "morph",
        "ncompass",
        "near-ai",
        "nebius",
        "nex-agi",
        "nextbit",
        "nineteen",
        "novita",
        "nvidia",
        "octoai",
        "ollama",
        "open-inference",
        "openai",
        "parasail",
        "perceptron",
        "perplexity",
        "phala",
        "poolside",
        "primeintellect",
        "quiver",
        "recraft",
        "recursal",
        "reflection",
        "reka",
        "relace",
        "replicate",
        "respan",
        "runway",
        "sail-research",
        "sakana",
        "sakana-ai",
        "sambanova",
        "sambanova-cloaked",
        "scaledown",
        "seed",
        "sf-compute",
        "siliconflow",
        "sourceful",
        "stealth",
        "stepfun",
        "streamlake",
        "switchpoint",
        "targon",
        "tencent",
        "tenstorrent",
        "thinkingmachines",
        "together",
        "together-lite",
        "typesafe",
        "ubicloud",
        "unbiased",
        "upstage",
        "venice",
        "voyageai",
        "wafer",
        "wandb",
        "wandb-legacy",
        "xai",
        "xiaomi",
        "z-ai"
      ]
    },
    "additionalProperties": {
      "type": "object"
    }
  },
  "PreferredMaxLatency": {
    "anyOf": [
      {
        "type": "number"
      },
      {
        "$ref": "#/$defs/PercentileLatencyCutoffs"
      },
      {
        "type": "null"
      }
    ]
  },
  "PercentileLatencyCutoffs": {
    "properties": {
      "p50": {
        "type": [
          "number",
          "null"
        ]
      },
      "p75": {
        "type": [
          "number",
          "null"
        ]
      },
      "p90": {
        "type": [
          "number",
          "null"
        ]
      },
      "p99": {
        "type": [
          "number",
          "null"
        ]
      }
    },
    "type": "object",
    "additionalProperties": false
  },
  "PreferredMinThroughput": {
    "anyOf": [
      {
        "type": "number"
      },
      {
        "$ref": "#/$defs/PercentileThroughputCutoffs"
      },
      {
        "type": "null"
      }
    ]
  },
  "PercentileThroughputCutoffs": {
    "properties": {
      "p50": {
        "type": [
          "number",
          "null"
        ]
      },
      "p75": {
        "type": [
          "number",
          "null"
        ]
      },
      "p90": {
        "type": [
          "number",
          "null"
        ]
      },
      "p99": {
        "type": [
          "number",
          "null"
        ]
      }
    },
    "type": "object",
    "additionalProperties": false
  },
  "Quantization": {
    "enum": [
      "int4",
      "int8",
      "fp4",
      "mxfp4",
      "nvfp4",
      "fp6",
      "fp8",
      "mxfp8",
      "fp16",
      "bf16",
      "fp32",
      "unknown"
    ],
    "type": "string"
  },
  "ProviderSort": {
    "enum": [
      "price",
      "throughput",
      "latency",
      "exacto"
    ],
    "type": "string"
  },
  "ProviderSortConfig": {
    "properties": {
      "by": {
        "enum": [
          "price",
          "throughput",
          "latency",
          "exacto",
          null
        ],
        "type": [
          "string",
          "null"
        ]
      },
      "partition": {
        "enum": [
          "model",
          "none",
          null
        ],
        "type": [
          "string",
          "null"
        ]
      }
    },
    "type": "object",
    "additionalProperties": false
  },
  "DecisionsNoulQuestion": {
    "properties": {
      "criteria": {
        "properties": {
          "false": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "additionalProperties": {},
                "type": "object"
              },
              {
                "items": {},
                "type": "array"
              }
            ]
          },
          "true": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "additionalProperties": {},
                "type": "object"
              },
              {
                "items": {},
                "type": "array"
              }
            ]
          }
        },
        "required": [
          "true",
          "false"
        ],
        "type": "object",
        "additionalProperties": false
      },
      "instructions": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "additionalProperties": {},
            "type": "object"
          },
          {
            "items": {},
            "type": "array"
          }
        ]
      },
      "type": {
        "enum": [
          "noul"
        ],
        "type": "string"
      }
    },
    "required": [
      "type",
      "instructions"
    ],
    "type": "object",
    "additionalProperties": false
  },
  "DecisionsChoiceQuestion": {
    "properties": {
      "criteria": {
        "additionalProperties": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "additionalProperties": {},
              "type": "object"
            },
            {
              "items": {},
              "type": "array"
            },
            {
              "type": "null"
            }
          ]
        },
        "type": "object",
        "minProperties": 1,
        "maxProperties": 255
      },
      "instructions": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "additionalProperties": {},
            "type": "object"
          },
          {
            "items": {},
            "type": "array"
          }
        ]
      },
      "type": {
        "enum": [
          "choice"
        ],
        "type": "string"
      }
    },
    "required": [
      "type",
      "instructions",
      "criteria"
    ],
    "type": "object",
    "additionalProperties": false
  },
  "DecisionsScoreQuestion": {
    "properties": {
      "criteria": {
        "items": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "additionalProperties": {},
              "type": "object"
            },
            {
              "items": {},
              "type": "array"
            }
          ]
        },
        "minItems": 1,
        "type": "array",
        "maxItems": 10
      },
      "instructions": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "additionalProperties": {},
            "type": "object"
          },
          {
            "items": {},
            "type": "array"
          }
        ]
      },
      "type": {
        "enum": [
          "score"
        ],
        "type": "string"
      }
    },
    "required": [
      "type",
      "instructions",
      "criteria"
    ],
    "type": "object",
    "additionalProperties": false
  },
  "TraceConfig": {
    "additionalProperties": {},
    "properties": {
      "generation_name": {
        "type": "string"
      },
      "parent_span_id": {
        "type": "string"
      },
      "span_name": {
        "type": "string"
      },
      "trace_id": {
        "type": "string"
      },
      "trace_name": {
        "type": "string"
      }
    },
    "type": "object"
  }
} as const;

export const decisionInputJsonSchema = {
  "properties": {
    "model": {
      "type": "string",
      "minLength": 1,
      "default": "~typesafe/jev-latest"
    },
    "provider": {
      "allOf": [
        {
          "$ref": "#/$defs/ProviderPreferences"
        },
        {}
      ]
    },
    "questions": {
      "additionalProperties": {
        "oneOf": [
          {
            "$ref": "#/$defs/DecisionsNoulQuestion"
          },
          {
            "$ref": "#/$defs/DecisionsChoiceQuestion"
          },
          {
            "$ref": "#/$defs/DecisionsScoreQuestion"
          }
        ]
      },
      "type": "object",
      "minProperties": 1,
      "description": "Independent typed questions over the same state. IDs are returned unchanged."
    },
    "session_id": {
      "maxLength": 256,
      "type": "string"
    },
    "state": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "additionalProperties": {},
          "type": "object"
        },
        {
          "items": {},
          "type": "array"
        }
      ]
    },
    "trace": {
      "$ref": "#/$defs/TraceConfig"
    },
    "user": {
      "maxLength": 256,
      "type": "string"
    },
    "policy": {
      "type": "object",
      "additionalProperties": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "type": {
                "const": "choice"
              },
              "min_confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              "min_probability": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              "min_margin": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "type"
            ],
            "anyOf": [
              {
                "required": [
                  "min_confidence"
                ]
              },
              {
                "required": [
                  "min_probability"
                ]
              },
              {
                "required": [
                  "min_margin"
                ]
              }
            ]
          },
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "type": {
                "const": "noul"
              },
              "false_max": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              "true_min": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "type",
              "false_max",
              "true_min"
            ]
          },
          {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "type": {
                "const": "score"
              },
              "min_confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              }
            },
            "required": [
              "type",
              "min_confidence"
            ]
          }
        ]
      }
    },
    "execution": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "timeout_ms": {
          "type": "integer",
          "minimum": 1000,
          "maximum": 120000,
          "default": 30000
        },
        "max_retries": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2,
          "default": 0
        },
        "dry_run": {
          "type": "boolean",
          "default": false
        }
      }
    }
  },
  "required": [
    "state",
    "questions"
  ],
  "type": "object",
  "additionalProperties": false,
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "delegate-mcp decision input v0.2",
  $defs: sharedDefinitions,
} as const;

export const decisionOutputJsonSchema = {
  "type": "object",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "delegate-mcp decision output v0.2",
  "oneOf": [
    {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "kind": {
          "const": "decision"
        },
        "result": {
          "$ref": "#/$defs/DecisionsResponse"
        },
        "assessments": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "status": {
                "enum": [
                  "accepted",
                  "uncertain",
                  "unassessed"
                ]
              },
              "value": {
                "type": [
                  "string",
                  "number",
                  "boolean",
                  "null"
                ]
              },
              "reasons": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "required": [
              "status",
              "value",
              "reasons"
            ]
          }
        },
        "meta": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "request_id": {
              "type": "string"
            },
            "requested_model": {
              "type": "string"
            },
            "elapsed_ms": {
              "type": "integer",
              "minimum": 0
            },
            "attempts": {
              "type": "integer",
              "minimum": 0
            },
            "api_version": {
              "const": "alpha-decisions"
            },
            "warnings": {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          },
          "required": [
            "request_id",
            "requested_model",
            "elapsed_ms",
            "attempts",
            "api_version",
            "warnings"
          ]
        }
      },
      "required": [
        "kind",
        "result",
        "assessments",
        "meta"
      ]
    },
    {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "kind": {
          "const": "dry_run"
        },
        "request": {
          "properties": {
            "model": {
              "type": "string",
              "minLength": 1,
              "default": "~typesafe/jev-latest"
            },
            "provider": {
              "allOf": [
                {
                  "$ref": "#/$defs/ProviderPreferences"
                },
                {}
              ]
            },
            "questions": {
              "additionalProperties": {
                "oneOf": [
                  {
                    "$ref": "#/$defs/DecisionsNoulQuestion"
                  },
                  {
                    "$ref": "#/$defs/DecisionsChoiceQuestion"
                  },
                  {
                    "$ref": "#/$defs/DecisionsScoreQuestion"
                  }
                ]
              },
              "type": "object",
              "minProperties": 1,
              "description": "Independent typed questions over the same state. IDs are returned unchanged."
            },
            "session_id": {
              "maxLength": 256,
              "type": "string"
            },
            "state": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "additionalProperties": {},
                  "type": "object"
                },
                {
                  "items": {},
                  "type": "array"
                }
              ]
            },
            "trace": {
              "$ref": "#/$defs/TraceConfig"
            },
            "user": {
              "maxLength": 256,
              "type": "string"
            }
          },
          "required": [
            "model",
            "state",
            "questions"
          ],
          "type": "object",
          "additionalProperties": false
        },
        "meta": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "request_id": {
              "type": "string"
            },
            "requested_model": {
              "type": "string"
            },
            "elapsed_ms": {
              "type": "integer",
              "minimum": 0
            },
            "attempts": {
              "type": "integer",
              "minimum": 0
            },
            "api_version": {
              "const": "alpha-decisions"
            },
            "warnings": {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          },
          "required": [
            "request_id",
            "requested_model",
            "elapsed_ms",
            "attempts",
            "api_version",
            "warnings"
          ]
        }
      },
      "required": [
        "kind",
        "request",
        "meta"
      ]
    },
    {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "kind": {
          "const": "error"
        },
        "error": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "code": {
              "enum": [
                "CONFIG_ERROR",
                "INVALID_ARGUMENT",
                "POLICY_CONFLICT",
                "INPUT_TOO_LARGE",
                "UPSTREAM_AUTH",
                "UPSTREAM_PAYMENT",
                "UPSTREAM_FORBIDDEN",
                "UPSTREAM_NOT_FOUND",
                "UPSTREAM_REQUEST",
                "UPSTREAM_RATE_LIMIT",
                "UPSTREAM_UNAVAILABLE",
                "UPSTREAM_TIMEOUT",
                "UPSTREAM_PROTOCOL",
                "NETWORK_ERROR",
                "CANCELLED"
              ]
            },
            "message": {
              "type": "string"
            },
            "http_status": {
              "type": "integer"
            },
            "retryable": {
              "type": "boolean"
            },
            "billing_uncertain": {
              "type": "boolean"
            }
          },
          "required": [
            "code",
            "message",
            "retryable",
            "billing_uncertain"
          ]
        },
        "meta": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "request_id": {
              "type": "string"
            },
            "requested_model": {
              "type": "string"
            },
            "elapsed_ms": {
              "type": "integer",
              "minimum": 0
            },
            "attempts": {
              "type": "integer",
              "minimum": 0
            },
            "api_version": {
              "const": "alpha-decisions"
            },
            "warnings": {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          },
          "required": [
            "request_id",
            "requested_model",
            "elapsed_ms",
            "attempts",
            "api_version",
            "warnings"
          ]
        }
      },
      "required": [
        "kind",
        "error",
        "meta"
      ]
    }
  ],
  $defs: {
    ...sharedDefinitions,
  "DecisionsResponse": {
    "properties": {
      "answers": {
        "additionalProperties": {
          "oneOf": [
            {
              "$ref": "#/$defs/DecisionsNoulAnswer"
            },
            {
              "$ref": "#/$defs/DecisionsChoiceAnswer"
            },
            {
              "$ref": "#/$defs/DecisionsScoreAnswer"
            }
          ]
        },
        "type": "object"
      },
      "id": {
        "type": "string"
      },
      "model": {
        "type": "string"
      },
      "provider": {
        "type": "string"
      },
      "usage": {
        "properties": {
          "cost": {
            "type": "number"
          },
          "input_tokens": {
            "type": "integer"
          },
          "output_tokens": {
            "type": "integer"
          }
        },
        "required": [
          "input_tokens",
          "output_tokens"
        ],
        "type": "object"
      }
    },
    "required": [
      "model",
      "answers",
      "usage"
    ],
    "type": "object"
  },
  "DecisionsNoulAnswer": {
    "properties": {
      "noul": {
        "type": "number"
      },
      "type": {
        "enum": [
          "noul"
        ],
        "type": "string"
      }
    },
    "required": [
      "type",
      "noul"
    ],
    "type": "object"
  },
  "DecisionsChoiceAnswer": {
    "properties": {
      "choice": {
        "type": "string"
      },
      "confidence": {
        "type": "number"
      },
      "probabilities": {
        "additionalProperties": {
          "type": "number"
        },
        "type": "object"
      },
      "type": {
        "enum": [
          "choice"
        ],
        "type": "string"
      }
    },
    "required": [
      "type",
      "choice"
    ],
    "type": "object"
  },
  "DecisionsScoreAnswer": {
    "properties": {
      "confidence": {
        "type": "number"
      },
      "legend": {
        "additionalProperties": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "additionalProperties": {},
              "type": "object"
            },
            {
              "items": {},
              "type": "array"
            }
          ]
        },
        "type": "object"
      },
      "probabilities": {
        "additionalProperties": {
          "type": "number"
        },
        "type": "object"
      },
      "score": {
        "type": "number"
      },
      "type": {
        "enum": [
          "score"
        ],
        "type": "string"
      }
    },
    "required": [
      "type",
      "score"
    ],
    "type": "object"
  }
  },
} as const;

export const providerOptionSlugs = decisionInputJsonSchema.$defs.ProviderOptions.propertyNames.enum;
export type ProviderOptionSlug = typeof providerOptionSlugs[number];

const percentileSchema = strictObject({
  p50: z.number().nullable().optional(),
  p75: z.number().nullable().optional(),
  p90: z.number().nullable().optional(),
  p99: z.number().nullable().optional(),
});
const sortSchema = z.enum(["price", "throughput", "latency", "exacto"]);
const providerOptionsSchema = jsonRecord(jsonObjectSchema).refine((options) =>
  Object.keys(options).every((slug) => (providerOptionSlugs as readonly string[]).includes(slug)),
);
export const providerPreferencesSchema = strictObject({
  allow_fallbacks: z.boolean().nullable().optional(),
  require_parameters: z.boolean().nullable().optional(),
  data_collection: z.enum(["allow", "deny"]).nullable().optional(),
  zdr: z.boolean().nullable().optional(),
  enforce_distillable_text: z.boolean().nullable().optional(),
  only: z.array(z.string()).nullable().optional(),
  ignore: z.array(z.string()).nullable().optional(),
  order: z.array(z.string()).nullable().optional(),
  sort: z.union([sortSchema, strictObject({
    by: sortSchema.nullable().optional(),
    partition: z.enum(["model", "none"]).nullable().optional(),
  })]).nullable().optional(),
  max_price: strictObject({
    prompt: z.string().optional(),
    completion: z.string().optional(),
    request: z.string().optional(),
    image: z.string().optional(),
    audio: z.string().optional(),
  }).optional(),
  preferred_max_latency: z.union([z.number(), percentileSchema]).nullable().optional(),
  preferred_min_throughput: z.union([z.number(), percentileSchema]).nullable().optional(),
  quantizations: z.array(z.enum([
    "int4", "int8", "fp4", "mxfp4", "nvfp4", "fp6", "fp8", "mxfp8", "fp16", "bf16", "fp32", "unknown",
  ])).nullable().optional(),
  options: providerOptionsSchema.optional(),
}).nullable();
export type ProviderPreferences = z.infer<typeof providerPreferencesSchema>;

const choiceQuestionSchema = strictObject({
  type: z.literal("choice"),
  instructions: structuredSchema,
  criteria: jsonRecord(structuredSchema.nullable()).refine((criteria) =>
    Object.keys(criteria).length >= 1 && Object.keys(criteria).length <= 255,
  ),
});
const noulQuestionSchema = strictObject({
  type: z.literal("noul"),
  instructions: structuredSchema,
  criteria: strictObject({ true: structuredSchema, false: structuredSchema }).optional(),
});
const scoreQuestionSchema = strictObject({
  type: z.literal("score"),
  instructions: structuredSchema,
  criteria: z.array(structuredSchema).min(1).max(10),
});
export const decisionQuestionSchema = z.union([
  choiceQuestionSchema, noulQuestionSchema, scoreQuestionSchema,
]);
export type DecisionQuestion = z.infer<typeof decisionQuestionSchema>;

const choicePolicySchema = strictObject({
  type: z.literal("choice"),
  min_confidence: probabilitySchema.optional(),
  min_probability: probabilitySchema.optional(),
  min_margin: probabilitySchema.optional(),
}).refine((rule) => rule.min_confidence !== undefined ||
  rule.min_probability !== undefined || rule.min_margin !== undefined);
const noulPolicySchema = strictObject({
  type: z.literal("noul"), false_max: probabilitySchema, true_min: probabilitySchema,
});
const scorePolicySchema = strictObject({
  type: z.literal("score"), min_confidence: probabilitySchema,
});
export const decisionPolicySchema = jsonRecord(z.union([
  choicePolicySchema, noulPolicySchema, scorePolicySchema,
]));
export type DecisionPolicy = z.infer<typeof decisionPolicySchema>;

export const decisionExecutionSchema = strictObject({
  timeout_ms: z.number().refine(Number.isInteger).min(1000).max(120000).optional(),
  max_retries: z.number().refine(Number.isInteger).min(0).max(2).optional(),
  dry_run: z.boolean().optional(),
});
export type DecisionExecution = z.infer<typeof decisionExecutionSchema>;

export type DecisionTrace = JsonObject & {
  trace_id?: string;
  trace_name?: string;
  span_name?: string;
  generation_name?: string;
  parent_span_id?: string;
};
const traceNames = ["trace_id", "trace_name", "span_name", "generation_name", "parent_span_id"];
const traceSchema = z.custom<DecisionTrace>((value) => {
  if (!jsonObjectSchema.safeParse(value).success) return false;
  const trace = value as JsonObject;
  return traceNames.every((key) => !Object.hasOwn(trace, key) || typeof trace[key] === "string");
});

const requestShape = {
  state: structuredSchema,
  questions: jsonRecord(decisionQuestionSchema).refine((questions) => Object.keys(questions).length >= 1),
  model: z.string().min(1),
  provider: providerPreferencesSchema.optional(),
  trace: traceSchema.optional(),
  user: codePointString(256).optional(),
  session_id: codePointString(256).optional(),
};
export const decisionsRequestSchema = strictObject(requestShape);
export type DecisionsRequest = z.infer<typeof decisionsRequestSchema>;
export const decisionArgsSchema = strictObject({
  ...requestShape,
  model: requestShape.model.optional(),
  policy: decisionPolicySchema.optional(),
  execution: decisionExecutionSchema.optional(),
});
export type DecisionArgs = z.infer<typeof decisionArgsSchema>;

// Upstream objects allow extra fields in the canonical output schema. D03 must
// select documented fields before constructing an envelope; these validate form.
const probabilitiesSchema = jsonRecord(z.number());
const noulAnswerSchema = z.object({
  type: z.literal("noul"), noul: z.number(),
}).catchall(jsonValueSchema);
const choiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number().optional(),
  probabilities: probabilitiesSchema.optional(),
}).catchall(jsonValueSchema);
const scoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  confidence: z.number().optional(),
  probabilities: probabilitiesSchema.optional(),
  legend: jsonRecord(structuredSchema).optional(),
}).catchall(jsonValueSchema);
export const decisionAnswerSchema = z.union([
  noulAnswerSchema, choiceAnswerSchema, scoreAnswerSchema,
]);
export type DecisionAnswer = z.infer<typeof decisionAnswerSchema>;
export const decisionsResponseSchema = z.object({
  model: z.string(),
  answers: jsonRecord(decisionAnswerSchema),
  usage: z.object({
    input_tokens: z.number().refine(Number.isInteger),
    output_tokens: z.number().refine(Number.isInteger),
    cost: z.number().optional(),
  }).catchall(jsonValueSchema),
  id: z.string().optional(),
  provider: z.string().optional(),
}).catchall(jsonValueSchema);
export type DecisionsResponse = z.infer<typeof decisionsResponseSchema>;

export const decisionAssessmentSchema = strictObject({
  status: z.enum(["accepted", "uncertain", "unassessed"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  reasons: z.array(z.string()),
});
export type DecisionAssessment = z.infer<typeof decisionAssessmentSchema>;
export const decisionMetaSchema = strictObject({
  request_id: z.string(),
  requested_model: z.string(),
  elapsed_ms: z.number().refine(Number.isInteger).min(0),
  attempts: z.number().refine(Number.isInteger).min(0),
  api_version: z.literal("alpha-decisions"),
  warnings: z.array(z.string()),
});
export type DecisionMeta = z.infer<typeof decisionMetaSchema>;
export const decisionErrorSchema = strictObject({
  code: z.enum([
    "CONFIG_ERROR", "INVALID_ARGUMENT", "POLICY_CONFLICT", "INPUT_TOO_LARGE",
    "UPSTREAM_AUTH", "UPSTREAM_PAYMENT", "UPSTREAM_FORBIDDEN", "UPSTREAM_NOT_FOUND",
    "UPSTREAM_REQUEST", "UPSTREAM_RATE_LIMIT", "UPSTREAM_UNAVAILABLE", "UPSTREAM_TIMEOUT",
    "UPSTREAM_PROTOCOL", "NETWORK_ERROR", "CANCELLED",
  ]),
  message: z.string(),
  http_status: z.number().refine(Number.isInteger).optional(),
  retryable: z.boolean(),
  billing_uncertain: z.boolean(),
});
export type DecisionError = z.infer<typeof decisionErrorSchema>;
export type DecisionErrorCode = DecisionError["code"];
export const decisionEnvelopeSchema = z.union([
  strictObject({
    kind: z.literal("decision"),
    result: decisionsResponseSchema,
    assessments: jsonRecord(decisionAssessmentSchema),
    meta: decisionMetaSchema,
  }),
  strictObject({
    kind: z.literal("dry_run"), request: decisionsRequestSchema, meta: decisionMetaSchema,
  }),
  strictObject({
    kind: z.literal("error"), error: decisionErrorSchema, meta: decisionMetaSchema,
  }),
]);
export type DecisionEnvelope = z.infer<typeof decisionEnvelopeSchema>;
export type DecisionValidation<T> =
  | { success: true; data: T }
  | { success: false; error: { code: "INVALID_ARGUMENT" | "UPSTREAM_PROTOCOL"; message: string } };

function validate<T>(
  schema: z.ZodType<T>, value: unknown,
  code: "INVALID_ARGUMENT" | "UPSTREAM_PROTOCOL", message: string,
): DecisionValidation<T> {
  if (!isJson(value) || !schema.safeParse(value).success) {
    // Do not expose Zod issues: keys, enum values and paths may contain secrets.
    return { success: false, error: { code, message } };
  }
  // A validator adds no defaults, strips no JSON keys, and preserves optional absence.
  return { success: true, data: value as T };
}

export function validateDecisionArgs(value: unknown): DecisionValidation<DecisionArgs> {
  return validate(decisionArgsSchema, value, "INVALID_ARGUMENT", "Invalid decision arguments.");
}
export function validateDecisionEnvelope(value: unknown): DecisionValidation<DecisionEnvelope> {
  return validate(decisionEnvelopeSchema, value, "UPSTREAM_PROTOCOL", "Invalid decision envelope.");
}
export function validateDecisionsResponse(value: unknown): DecisionValidation<DecisionsResponse> {
  return validate(decisionsResponseSchema, value, "UPSTREAM_PROTOCOL", "Invalid decision response.");
}
