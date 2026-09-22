import React, { useState, useEffect } from "react";
import {
  FaSearch,
  FaEllipsisV,
  FaCircleNotch,
  FaUserCircle,
  FaCheck,
  FaCheckDouble,
  FaTimes,
  FaUsers,
  FaPlus,
} from "react-icons/fa";
import { MdOutlineChat } from "react-icons/md";
import useUserStore from "../store/useUserStore";
import useLayoutStore from "../store/useLayoutStore";
import useChatStore from "../store/useChatStore";
import { toast } from "react-toastify";
import { getAllUsers } from "../services/userService";
import { searchMessages, createGroup } from "../services/chat.api";
import { getAvatarUrl } from "../utils/avatarUtil";

const ChatList = () => {
  const { user: currentUser } = useUserStore();
  const { selectedContact, setSelectedContact, setActiveTab } = useLayoutStore();
  const { conversations, isUserOnline, fetchConversations } = useChatStore();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all"); // 'all' | 'unread' | 'groups'
  const [showMenu, setShowMenu] = useState(false);

  // Message-body search results, shown alongside the contact filter.
  const [messageResults, setMessageResults] = useState([]);
  const [searchingMessages, setSearchingMessages] = useState(false);

  // --- Group creation --------------------------------------------------------------------------
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Groups are conversations, not users, so they cannot come from the contact list.
  const groups = (Array.isArray(conversations) ? conversations : []).filter((c) => c.isGroup);

  const openGroup = (group) =>
    setSelectedContact({
      _id: group._id,
      isGroup: true,
      name: group.name,
      participants: group.participants,
      // Carried so ChatWindow can show admin-only controls. The server enforces this independently.
      amIAdmin: (group.admins || []).some(
        (a) => (a._id || a)?.toString() === currentUser?._id?.toString()
      ),
    });

  const toggleMember = (id) =>
    setSelectedMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();

    if (!name) {
      toast.error("Give the group a name");
      return;
    }
    if (!selectedMembers.length) {
      toast.error("Select at least one member");
      return;
    }

    setCreatingGroup(true);
    try {
      const res = await createGroup({ name, participantIds: selectedMembers });
      const group = res?.data;

      setShowCreateGroup(false);
      setNewGroupName("");
      setSelectedMembers([]);
      await fetchConversations();

      if (group?._id) openGroup(group);
      toast.success("Group created");
    } catch (err) {
      toast.error(err?.message || "Could not create the group");
    } finally {
      setCreatingGroup(false);
    }
  };

  // Debounced, and only from 3 characters — the contact filter is instant and local, but this one
  // hits the API, so firing on every keystroke would be wasteful.
  useEffect(() => {
    const q = searchQuery.trim();

    if (q.length < 3) {
      setMessageResults([]);
      setSearchingMessages(false);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        setSearchingMessages(true);
        const res = await searchMessages(q);
        if (!cancelled) setMessageResults(res?.data?.messages || []);
      } catch {
        if (!cancelled) setMessageResults([]);
      } finally {
        if (!cancelled) setSearchingMessages(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        setLoading(true);
        const response = await getAllUsers();
        const userList = response?.data?.users || response?.users || [];
        setUsers(userList);
      } catch (err) {
        console.error("Failed to fetch users:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, []);

  const filteredUsers = users.filter((u) => {
    const conv = conversations.find((c) =>
      c.participants?.some((p) => (p._id || p)?.toString() === u._id?.toString())
    );
    const unread = conv?.unreadCount ?? u.unreadCount ?? 0;

    const nameMatch =
      u.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.phoneNumber?.includes(searchQuery);

    if (filterType === "unread") {
      return nameMatch && unread > 0;
    }
    return nameMatch;
  });

  const formatTime = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#111b21] border-r border-[#e9edef] dark:border-[#222e35] select-none transition-colors">
      <div className="h-16 px-4 bg-[#f0f2f5] dark:bg-[#202c33] flex items-center justify-between border-b border-[#e9edef] dark:border-[#222e35] flex-shrink-0">
        <div
          onClick={() => setActiveTab("profile")}
          className="flex items-center gap-3 cursor-pointer group"
          title="View profile"
        >
          <img
            src={getAvatarUrl(currentUser, currentUser?.username)}
            alt="My Profile"
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = getAvatarUrl(null, currentUser?.username);
            }}
            className="w-10 h-10 rounded-full object-cover ring-2 ring-transparent group-hover:ring-[#00a884] transition-all"
          />
          <span className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef] hidden sm:inline max-w-[120px] truncate">
            {currentUser?.username || "You"}
          </span>
        </div>

        <div className="flex items-center gap-1 text-[#54656f] dark:text-[#aebac1]">
          <button
            onClick={() => setActiveTab("status")}
            className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            title="Status"
          >
            <FaCircleNotch className="w-5 h-5" />
          </button>
          <button
            onClick={() => setActiveTab("chats")}
            className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            title="New chat"
          >
            <MdOutlineChat className="w-5 h-5" />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              title="Menu"
            >
              <FaEllipsisV className="w-4 h-4" />
            </button>
            {showMenu && (
              <div
                className="absolute right-0 top-10 w-44 bg-white dark:bg-[#233138] rounded-lg shadow-xl border border-gray-100 dark:border-[#222e35] py-2 z-50 text-sm"
                onMouseLeave={() => setShowMenu(false)}
              >
                <button
                  onClick={() => {
                    setShowCreateGroup(true);
                    setShowMenu(false);
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-[#f0f2f5] dark:hover:bg-[#182229] text-[#111b21] dark:text-[#e9edef] flex items-center gap-2"
                >
                  <FaUsers className="w-3.5 h-3.5" />
                  New group
                </button>
                <button
                  onClick={() => {
                    setActiveTab("profile");
                    setShowMenu(false);
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-[#f0f2f5] dark:hover:bg-[#182229] text-[#111b21] dark:text-[#e9edef]"
                >
                  Profile
                </button>
                <button
                  onClick={() => {
                    setActiveTab("settings");
                    setShowMenu(false);
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-[#f0f2f5] dark:hover:bg-[#182229] text-[#111b21] dark:text-[#e9edef]"
                >
                  Settings
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-2.5 bg-white dark:bg-[#111b21] border-b border-[#e9edef] dark:border-[#222e35] flex flex-col gap-2 flex-shrink-0">
        <div className="flex items-center h-9 px-3 bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg text-sm text-[#111b21] dark:text-[#e9edef]">
          <FaSearch className="w-3.5 h-3.5 text-[#8696a0] mr-3 flex-shrink-0" />
          <input
            type="text"
            placeholder="Search or start new chat"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent outline-none text-xs placeholder-[#8696a0]"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")}>
              <FaTimes className="w-3 h-3 text-[#8696a0] hover:text-gray-700 dark:hover:text-white" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 px-1">
          <button
            onClick={() => setFilterType("all")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filterType === "all"
                ? "bg-[#00a884]/15 text-[#00a884] dark:bg-[#00a884]/25"
                : "bg-[#f0f2f5] dark:bg-[#202c33] text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#2a3942]"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterType("unread")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filterType === "unread"
                ? "bg-[#00a884]/15 text-[#00a884] dark:bg-[#00a884]/25"
                : "bg-[#f0f2f5] dark:bg-[#202c33] text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#2a3942]"
            }`}
          >
            Unread
          </button>
        </div>
      </div>

      {/* Message-body matches, above the contact list, so a query finds both people and things
          that were said. */}
      {searchQuery.trim().length >= 3 && (searchingMessages || messageResults.length > 0) && (
        <div className="border-b border-[#e9edef] dark:border-[#222e35] max-h-56 overflow-y-auto">
          <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[#00a884] font-semibold">
            Messages
          </p>

          {searchingMessages && messageResults.length === 0 ? (
            <p className="px-3 pb-2 text-[11px] text-[#8696a0]">Searching…</p>
          ) : (
            messageResults.map((m) => {
              const isMine = m.sender?._id?.toString() === currentUser?._id?.toString();
              const other = (isMine ? m.receiver : m.sender) || {};
              const name = other.username || "Unknown contact";

              return (
                <button
                  key={m._id}
                  onClick={() => {
                    setSelectedContact({
                      _id: other._id,
                      username: other.username,
                      profilePicture: other.profilePicture,
                    });
                    setSearchQuery("");
                  }}
                  className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5"
                >
                  {other.profilePicture ? (
                    <img
                      src={getAvatarUrl(other.profilePicture)}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <span className="w-8 h-8 rounded-full bg-[#00a884]/15 text-[#00a884] flex items-center justify-center text-xs font-medium flex-shrink-0">
                      {name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block text-[12.5px] text-[#111b21] dark:text-[#e9edef]">
                      {name}
                    </span>
                    <span className="block text-[11px] truncate text-[#8696a0]">{m.content}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}

      {/* Groups get their own section: the list below is built by mapping USERS, so a group is not
          a user and would never appear there. */}
      {groups.length > 0 && (
        <div className="border-b border-[#e9edef] dark:border-[#222e35] max-h-64 overflow-y-auto">
          <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[#00a884] font-semibold">
            Groups
          </p>

          {groups.map((g) => (
            <button
              key={g._id}
              onClick={() => openGroup(g)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/5"
            >
              <span className="w-10 h-10 rounded-full bg-[#00a884]/15 text-[#00a884] flex items-center justify-center flex-shrink-0">
                <FaUsers className="w-4 h-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] text-[#111b21] dark:text-[#e9edef] truncate">
                  {g.name || "Group"}
                </span>
                <span className="block text-[11px] text-[#8696a0] truncate">
                  {g.lastMessage?.content || `${g.participants?.length || 0} members`}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto divide-y divide-[#e9edef]/60 dark:divide-[#222e35]/60">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#8696a0]">
            <div className="w-8 h-8 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin mb-3" />
            <span className="text-xs">Loading chats...</span>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="text-center py-12 px-6 text-[#8696a0]">
            <FaUsers className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-xs font-medium">No conversations found</p>
            <p className="text-[11px] mt-1 text-[#8696a0]/80">
              Users registered on Varnox will show up here.
            </p>
          </div>
        ) : (
          filteredUsers.map((userItem) => {
            const isSelected = selectedContact?._id === userItem._id;
            const conv = conversations.find((c) =>
              c.participants?.some((p) => (p._id || p)?.toString() === userItem._id?.toString())
            );
            const lastMsg = conv?.lastMessage || userItem.conversation?.lastMessage;
            const unread = conv?.unreadCount ?? userItem.unreadCount ?? 0;
            const isOnline = isUserOnline(userItem._id) || userItem.isOnline;

            return (
              <div
                key={userItem._id}
                onClick={() => setSelectedContact(userItem)}
                className={`flex items-center gap-3 px-3.5 py-3 cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-[#f0f2f5] dark:bg-[#2a3942]"
                    : "hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]/70"
                }`}
              >
                <div className="relative flex-shrink-0">
                  <img
                    src={getAvatarUrl(userItem, userItem.username)}
                    alt={userItem.username}
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = getAvatarUrl(null, userItem.username);
                    }}
                    className="w-12 h-12 rounded-full object-cover bg-gray-200 dark:bg-gray-700"
                  />
                  {isOnline && (
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-[#25d366] rounded-full border-2 border-white dark:border-[#111b21]" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef] truncate">
                      {userItem.username}
                    </h2>
                    <span className="text-[11px] text-[#8696a0] flex-shrink-0 ml-2 font-mono">
                      {formatTime(lastMsg?.createdAt || userItem.lastSeen)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-[#54656f] dark:text-[#8696a0]">
                    <p className="truncate text-xs text-[#54656f] dark:text-[#8696a0]">
                      {lastMsg?.content || userItem.about || "Hey there! I am using Varnox."}
                    </p>
                    {unread > 0 && (
                      <span className="ml-2 flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-[#25d366] text-white text-[10px] font-bold rounded-full flex-shrink-0">
                        {unread}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create-group modal. Members come from the already-fetched user list; the server re-checks
          that every id exists and always includes the creator. */}
      {showCreateGroup && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-[#111b21] shadow-xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="px-4 py-3 border-b border-[#e9edef] dark:border-[#222e35] flex items-center justify-between">
              <p className="font-medium text-[#111b21] dark:text-[#e9edef]">New group</p>
              <button
                onClick={() => setShowCreateGroup(false)}
                className="p-1.5 rounded-full text-[#8696a0] hover:bg-black/10 dark:hover:bg-white/10"
                title="Cancel"
              >
                <FaTimes className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-3">
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Group name"
                maxLength={60}
                className="w-full px-3 py-2 rounded-lg bg-[#f0f2f5] dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] text-sm outline-none focus:ring-1 focus:ring-[#00a884]"
              />
              <p className="mt-2 text-[11px] text-[#8696a0]">
                {selectedMembers.length
                  ? `${selectedMembers.length} member${selectedMembers.length === 1 ? "" : "s"} selected`
                  : "Select at least one member"}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto border-t border-[#e9edef] dark:border-[#222e35]">
              {users.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-[#8696a0]">No other users yet</p>
              ) : (
                users.map((u) => {
                  const checked = selectedMembers.includes(u._id);
                  return (
                    <button
                      key={u._id}
                      onClick={() => toggleMember(u._id)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      {u.profilePicture ? (
                        <img
                          src={getAvatarUrl(u.profilePicture)}
                          alt=""
                          className="w-9 h-9 rounded-full object-cover"
                        />
                      ) : (
                        <span className="w-9 h-9 rounded-full bg-[#00a884]/15 text-[#00a884] flex items-center justify-center text-sm font-medium">
                          {(u.username || "?").charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="flex-1 text-[14px] text-[#111b21] dark:text-[#e9edef] truncate">
                        {u.username || u.email || "User"}
                      </span>
                      <span
                        className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                          checked ? "bg-[#00a884] border-[#00a884]" : "border-[#8696a0]"
                        }`}
                      >
                        {checked ? <FaCheck className="w-3 h-3 text-white" /> : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="px-4 py-3 border-t border-[#e9edef] dark:border-[#222e35]">
              <button
                onClick={handleCreateGroup}
                disabled={creatingGroup}
                className="w-full py-2.5 rounded-lg bg-[#00a884] hover:bg-[#02906f] text-white font-medium transition-colors disabled:opacity-50"
              >
                {creatingGroup ? "Creating…" : "Create group"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatList;
