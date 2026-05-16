import { redirect } from 'next/navigation';

// Home → onboarding upload page
export default function Home() {
  redirect('/onboarding');
}
