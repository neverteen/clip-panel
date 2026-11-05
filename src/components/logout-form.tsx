import { Button } from "@/components/ui";
import { logout } from "@/app/logout/actions";

export function LogoutForm() {
  return <form action={logout}>
    <Button className="min-h-11" size="sm" type="submit" variant="ghost">Выйти</Button>
  </form>;
}
