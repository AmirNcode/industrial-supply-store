-- 02 — Reference PostgreSQL Schema
-- Adapt names/types to the existing project ORM and DB conventions.

CREATE TABLE product_families (
    id BIGSERIAL PRIMARY KEY,
    family_number INTEGER NOT NULL UNIQUE
        CHECK (family_number BETWEEN 1000 AND 9999),

    name TEXT NOT NULL,
    canonical_key TEXT NOT NULL UNIQUE,

    main_category_id BIGINT NULL,
    category_id BIGINT NULL,
    subcategory_id BIGINT NULL,

    -- JSON array of canonical identity field keys.
    -- Example: ["id_mm","cross_section_mm","od_mm","material","hardness"]
    identity_fields JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Next 1-based variant ordinal.
    -- 1 => A001, 999 => A999, 1000 => B001
    next_variant_ordinal INTEGER NOT NULL DEFAULT 1,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE part_number_registry (
    id BIGSERIAL PRIMARY KEY,

    product_family_id BIGINT NOT NULL
        REFERENCES product_families(id),

    part_number VARCHAR(8) NOT NULL UNIQUE,

    variant_ordinal INTEGER NOT NULL,

    identity_hash CHAR(64) NOT NULL,
    identity_payload JSONB NOT NULL,

    product_id BIGINT NULL,

    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','inactive','discontinued','reserved')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(product_family_id, identity_hash),
    UNIQUE(product_family_id, variant_ordinal)
);

-- Adapt ALTER TABLE to the existing products table.
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS product_family_id BIGINT NULL
        REFERENCES product_families(id);

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS part_number VARCHAR(8) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_products_part_number
    ON products(part_number)
    WHERE part_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_part_number_registry_family_hash
    ON part_number_registry(product_family_id, identity_hash);

CREATE INDEX IF NOT EXISTS ix_products_family
    ON products(product_family_id);

-- Optional audit trail for privileged identity corrections.
CREATE TABLE part_number_audit_log (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NULL,
    registry_id BIGINT NULL,
    action TEXT NOT NULL,
    old_value JSONB NULL,
    new_value JSONB NULL,
    actor_user_id BIGINT NULL,
    reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Family-number allocator.
-- Prefer a real DB sequence where possible.
CREATE SEQUENCE IF NOT EXISTS temex_family_number_seq
    START WITH 1000
    INCREMENT BY 1
    MINVALUE 1000
    MAXVALUE 9999
    NO CYCLE;

-- If existing family numbers are preloaded, advance sequence accordingly.
