import { Route, Routes } from 'react-router-dom'
import { Account, AdminRefunds, Changelog, Consent, Credits, ForgotPassword, Home, NotFound, Refunds, ResetPassword, SignIn, SignUp } from './pages'
import Legal from './Legal'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/sign-up" element={<SignUp />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/account" element={<Account />} />
      <Route path="/credits" element={<Credits />} />
      <Route path="/refunds" element={<Refunds />} />
      <Route path="/terms/refund" element={<Legal />} />
      <Route path="/admin/refunds" element={<AdminRefunds />} />
      <Route path="/consent" element={<Consent />} />
      <Route path="/changelog" element={<Changelog />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
