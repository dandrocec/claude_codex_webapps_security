const { body, param, validationResult } = require("express-validator");
const db = require("./db");

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireOperator(req, res, next) {
  if (!req.session.user || req.session.user.role !== "operator") return res.status(403).render("error", { message: "Forbidden" });
  next();
}

function currentUser(req, res, next) {
  res.locals.user = req.session.user || null;
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : "";
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
}

function collectValidation(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  req.session.flash = errors.array().map((err) => err.msg).join(" ");
  return res.redirect(req.get("referer") || "/");
}

function ownedService(req, res, next) {
  const service = db.prepare("SELECT * FROM services WHERE id = ? AND owner_id = ?").get(req.params.serviceId, req.session.user.id);
  if (!service) return res.status(404).render("error", { message: "Service not found" });
  req.service = service;
  next();
}

function ownedDeployment(req, res, next) {
  const deployment = db.prepare(`
    SELECT d.*, s.name AS service_name
    FROM deployments d
    JOIN services s ON s.id = d.service_id
    WHERE d.id = ? AND s.owner_id = ?
  `).get(req.params.deploymentId, req.session.user.id);
  if (!deployment) return res.status(404).render("error", { message: "Deployment not found" });
  req.deployment = deployment;
  next();
}

const rules = {
  register: [
    body("email").trim().isEmail().normalizeEmail().withMessage("Enter a valid email."),
    body("password").isLength({ min: 12, max: 128 }).withMessage("Password must be 12 to 128 characters."),
    body("role").isIn(["viewer", "operator"]).withMessage("Invalid role."),
    body("operator_token").optional({ checkFalsy: true }).isLength({ max: 256 }).trim().withMessage("Operator token is too long.")
  ],
  login: [
    body("email").trim().isEmail().normalizeEmail().withMessage("Enter a valid email."),
    body("password").isLength({ min: 1, max: 128 }).withMessage("Enter your password.")
  ],
  service: [
    body("name").trim().isLength({ min: 2, max: 80 }).matches(/^[\w .:-]+$/).withMessage("Service name contains invalid characters."),
    body("repository_url").trim().isURL({ require_protocol: true }).isLength({ max: 500 }).withMessage("Repository URL must be valid."),
    body("working_directory").optional({ checkFalsy: true }).trim().isLength({ max: 500 }).withMessage("Working directory is too long."),
    body("deploy_steps").trim().isLength({ min: 1, max: 4000 }).withMessage("Deployment steps are required and must be under 4000 characters.")
  ],
  secret: [
    body("name").trim().isLength({ min: 1, max: 80 }).matches(/^[A-Z_][A-Z0-9_]*$/).withMessage("Secret name must be an environment variable name."),
    body("value").isLength({ min: 1, max: 4000 }).withMessage("Secret value is required and must be under 4000 characters.")
  ],
  numericId: [
    param("serviceId").isInt({ min: 1 }).toInt().withMessage("Invalid service id.")
  ],
  deploymentId: [
    param("deploymentId").isInt({ min: 1 }).toInt().withMessage("Invalid deployment id.")
  ]
};

module.exports = {
  requireAuth,
  requireOperator,
  currentUser,
  collectValidation,
  ownedService,
  ownedDeployment,
  rules
};
