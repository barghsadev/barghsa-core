import { Route as rootRoute } from './routes/__root.js';
import { Route as indexRouteImport } from './routes/index.js';
import { Route as activateRouteImport } from './routes/activate.js';
import { Route as forgotPasswordRouteImport } from './routes/forgot-password.js';
import { Route as loginRouteImport } from './routes/login.js';
import { Route as registerRouteImport } from './routes/register.js';
import { Route as registerIndexRouteImport } from './routes/register/index.js';
import { Route as registerVerifyRouteImport } from './routes/register/verify.js';

// The production auth entry serves only these paths. The full generated tree
// stays in the main entry, avoiding every customer/admin route in auth startup.
const indexRoute = indexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRoute,
} as never);
const activateRoute = activateRouteImport.update({
  id: '/activate',
  path: '/activate',
  getParentRoute: () => rootRoute,
} as never);
const forgotPasswordRoute = forgotPasswordRouteImport.update({
  id: '/forgot-password',
  path: '/forgot-password',
  getParentRoute: () => rootRoute,
} as never);
const loginRoute = loginRouteImport.update({
  id: '/login',
  path: '/login',
  getParentRoute: () => rootRoute,
} as never);
const registerRoute = registerRouteImport.update({
  id: '/register',
  path: '/register',
  getParentRoute: () => rootRoute,
} as never);
const registerIndexRoute = registerIndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => registerRoute,
} as never);
const registerVerifyRoute = registerVerifyRouteImport.update({
  id: '/verify',
  path: '/verify',
  getParentRoute: () => registerRoute,
} as never);

export const routeTree = rootRoute._addFileChildren({
  IndexRoute: indexRoute,
  ActivateRoute: activateRoute,
  ForgotPasswordRoute: forgotPasswordRoute,
  LoginRoute: loginRoute,
  RegisterRoute: registerRoute._addFileChildren({
    RegisterIndexRoute: registerIndexRoute,
    RegisterVerifyRoute: registerVerifyRoute,
  }),
});
