
import joi from 'joi'

const joy = joi.defaults((schema) => {
  if (schema.type === `string`) {
    return schema.empty([null, ``]).default(null)
  } else if (schema.type === `number`) {
    return schema.empty([null]).default(null)
  } else if (schema.type === `boolean`) {
    return schema.empty([null]).default(null)
  } else if (schema.type === `date`) {
    return schema.empty([null]).default(null)
  } else if (schema.type === `object`) {
    return schema.empty([null]).default(null)
  }

  return schema
})

joy.easyValidate = function (schema, data) {
  const result = joi.object(schema).validate(data, {
    abortEarly: false,
    allowUnknown: true,
    stripUnknown: true,
  })

  const errorList = result.error?.details || []

  const errors = {
    hasErrors: errorList.length > 0,
  }

  for (const error of errorList) {
    errors[error.path.join(`.`)] = error
  }

  return [result.value, errors]
}

export default joy
