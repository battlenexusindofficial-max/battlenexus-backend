/**
 * Validation middleware using Joi
 * Install: npm install joi
 */
const Joi = require("joi");

const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });

    if (error) {
      const errors = error.details.map((detail) => detail.message);
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: errors,
      });
    }

    next();
  };
};

// Schemas
const orderSchema = Joi.object({
  amount: Joi.number().integer().positive().required().messages({
    "number.base": "Amount must be a number",
    "number.integer": "Amount must be an integer",
    "number.positive": "Amount must be positive",
    "any.required": "Amount is required",
  }),
  currency: Joi.string().default("INR"),
});

const verifySchema = Joi.object({
  order_id: Joi.string().required(),
});

module.exports = {
  validate,
  orderSchema,
  verifySchema,
};
