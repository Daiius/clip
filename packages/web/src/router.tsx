import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { api } from './api.ts'
import { HomePage } from './routes/home.tsx'
import { LoginPage } from './routes/login.tsx'

const rootRoute = createRootRoute({
  component: () => <Outlet />,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: LoginPage,
})

/**
 * ログイン必須の画面。**`/login` 以外はここを通す**（prd/04 §2）。
 *
 * 判定は server の `/api/auth/me` に委ねる。cookie は HttpOnly なので、web 側から
 * セッションの有無を直接見ることはできない（見えたらそれは JS から盗める cookie である）。
 */
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async ({ location }) => {
    const response = await api.auth.me.$get()
    if (!response.ok) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  component: HomePage,
})

const routeTree = rootRoute.addChildren([homeRoute, loginRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
