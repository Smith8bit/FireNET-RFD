# Re-export the two most-used auth dependencies so call sites can import
# directly from `app.auth` without knowing the internal module layout.
from .authen import current_active_user, current_superuser
