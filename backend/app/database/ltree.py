from sqlalchemy.types import UserDefinedType


class Ltree(UserDefinedType):
    # Required since SQLAlchemy 1.4.14: tells the compiled-statement cache
    # that this type instance carries no per-instance state and is safe to
    # reuse across queries.
    cache_ok = True

    def get_col_spec(self, **kw) -> str:
        # Emits the PostgreSQL-native LTREE type, enabling the
        # materialized-path operators (@>, <@, ~, ?) used for
        # ancestor/descendant region queries without recursive CTEs.
        return "LTREE"
