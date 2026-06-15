from sqlalchemy.types import UserDefinedType


class Ltree(UserDefinedType):
    cache_ok = True

    def get_col_spec(self, **kw):
        return "LTREE"

    def bind_processor(self, dialect):
        def process(value):
            return value

        return process

    def result_processor(self, dialect, coltype):
        def process(value):
            return value

        return process