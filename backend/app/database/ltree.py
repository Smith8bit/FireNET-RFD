from sqlalchemy.types import UserDefinedType


class Ltree(UserDefinedType):
    cache_ok = True

    def get_col_spec(self, **kw):
        return "LTREE"