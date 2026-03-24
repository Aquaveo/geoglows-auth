import { useOrg } from "./AuthProvider";

export function OrgSelector() {
  const { organizations, activeOrgId, setActiveOrgId } = useOrg();

  if (!organizations.length) return null;

  return (
    <select
      value={activeOrgId ?? ""}
      onChange={(e) => setActiveOrgId(e.target.value || null)}
    >
      {organizations.map((org) => (
        <option key={org.id} value={org.id}>
          {org.name}
        </option>
      ))}
    </select>
  );
}