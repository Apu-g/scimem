-- S1.3: enable extensions required by the SCIMEM schema.
-- vector: embedding columns + hnsw indexes (Appendix A)
-- pgcrypto: gen_random_uuid() primary keys (Appendix A)
create extension if not exists vector;
create extension if not exists pgcrypto;