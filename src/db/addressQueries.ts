import "server-only";
import { sql } from "./index";

export type SavedAddress = {
  id: string;
  label: string;
  recipient: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  isDefault: boolean;
};

export type AddressInput = Omit<SavedAddress, "id" | "isDefault">;

/** An account may keep this many; a warehouse list, not an address book. */
export const MAX_ADDRESSES = 20;

const COLS = sql`id, label, recipient, phone, address, city, postal_code AS "postalCode",
  is_default AS "isDefault"`;

/** The default first, then oldest first — the order the checkout picker shows. */
export async function listAddresses(userId: string): Promise<SavedAddress[]> {
  return sql<SavedAddress[]>`
    SELECT ${COLS} FROM user_addresses
    WHERE user_id = ${userId}
    ORDER BY is_default DESC, created_at, id
  `;
}

/** Ownership is in the WHERE: someone else's id matches nothing. */
export async function getAddress(userId: string, id: string): Promise<SavedAddress | null> {
  const [row] = await sql<SavedAddress[]>`
    SELECT ${COLS} FROM user_addresses WHERE id = ${id} AND user_id = ${userId}
  `;
  return row ?? null;
}

/**
 * The first address an account saves is its default without being asked;
 * later ones are not unless `makeDefault`. The account row is locked so two
 * saves at once cannot both see "no addresses yet" and both claim the default
 * (the partial unique index would refuse the second with an error page).
 */
export async function addAddress(
  userId: string,
  input: AddressInput,
  makeDefault = false,
): Promise<"added" | "full"> {
  return sql.begin(async (tx) => {
    await tx`SELECT 1 FROM users WHERE id = ${userId} FOR UPDATE`;
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM user_addresses WHERE user_id = ${userId}
    `;
    if (n >= MAX_ADDRESSES) return "full";
    const asDefault = makeDefault || n === 0;
    if (asDefault) await tx`UPDATE user_addresses SET is_default = false WHERE user_id = ${userId} AND is_default`;
    await tx`
      INSERT INTO user_addresses (user_id, label, recipient, phone, address, city, postal_code, is_default)
      VALUES (${userId}, ${input.label}, ${input.recipient}, ${input.phone}, ${input.address},
              ${input.city}, ${input.postalCode}, ${asDefault})
    `;
    return "added";
  });
}

export async function updateAddress(userId: string, id: string, input: AddressInput): Promise<boolean> {
  const result = await sql`
    UPDATE user_addresses
    SET label = ${input.label}, recipient = ${input.recipient}, phone = ${input.phone},
        address = ${input.address}, city = ${input.city}, postal_code = ${input.postalCode}
    WHERE id = ${id} AND user_id = ${userId}
  `;
  return result.count === 1;
}

export async function setDefaultAddress(userId: string, id: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    await tx`SELECT 1 FROM users WHERE id = ${userId} FOR UPDATE`;
    const [mine] = await tx`SELECT 1 FROM user_addresses WHERE id = ${id} AND user_id = ${userId}`;
    if (!mine) return false;
    // Cleared first: the partial unique index allows one default at a time.
    await tx`UPDATE user_addresses SET is_default = false WHERE user_id = ${userId} AND is_default`;
    await tx`UPDATE user_addresses SET is_default = true WHERE id = ${id} AND user_id = ${userId}`;
    return true;
  });
}

/**
 * Deleting the default hands it to the oldest address left, so an account
 * with any address always has a default for checkout to preselect.
 */
export async function deleteAddress(userId: string, id: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    await tx`SELECT 1 FROM users WHERE id = ${userId} FOR UPDATE`;
    const [gone] = await tx<{ isDefault: boolean }[]>`
      DELETE FROM user_addresses WHERE id = ${id} AND user_id = ${userId}
      RETURNING is_default AS "isDefault"
    `;
    if (!gone) return false;
    if (gone.isDefault) {
      await tx`
        UPDATE user_addresses SET is_default = true
        WHERE id = (
          SELECT id FROM user_addresses WHERE user_id = ${userId} ORDER BY created_at, id LIMIT 1
        )
      `;
    }
    return true;
  });
}
