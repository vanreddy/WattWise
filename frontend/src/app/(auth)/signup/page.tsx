"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();

  useEffect(() => {
    // Signup via invite is no longer supported. Redirect to login.
    router.replace("/login");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[70vh] text-gray-500">
      Redirecting to login...
    </div>
  );
}
