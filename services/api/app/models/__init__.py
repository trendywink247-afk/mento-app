"""Model registry — importing this module registers all mappers."""

from app.models.admin import AdminAccount, AdminAuditLog
from app.models.allowance import MessageAllowanceDay
from app.models.chat_message import ChatMessage, ChatReadMarker
from app.models.contribution import Contribution
from app.models.conversation import Conversation
from app.models.favourite import FavouriteListener
from app.models.feedback import ProductFeedback
from app.models.journal import JournalEntry
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.mentor_link import ListenerNameHistory, MentorLink
from app.models.moderation import ModerationEvent
from app.models.push_token import PushToken
from app.models.reflection import ConversationReflection
from app.models.request import ConversationRequest
from app.models.safety import SafetyFlag
from app.models.user import User

__all__ = [
    "AdminAccount",
    "AdminAuditLog",
    "Contribution",
    "Conversation",
    "ConversationReflection",
    "ConversationRequest",
    "FavouriteListener",
    "JournalEntry",
    "ListenerApplication",
    "ListenerNameHistory",
    "ListenerProfile",
    "MentorLink",
    "MessageAllowanceDay",
    "ModerationEvent",
    "ProductFeedback",
    "PushToken",
    "SafetyFlag",
    "User",
]
