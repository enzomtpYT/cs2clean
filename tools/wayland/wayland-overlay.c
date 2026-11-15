#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>
#include <wayland-client.h>

#include "wlr-layer-shell-unstable-v1-client-protocol.h"

enum {
  CMD_FRAME = 1,
  CMD_SHOW  = 2,
  CMD_HIDE  = 3,
  CMD_QUIT  = 4,
};

struct shm_slot {
  struct wl_buffer *buffer;
  void *data;
  size_t size;
  uint32_t width;
  uint32_t height;
  int busy;
};

struct app_state {
  struct wl_display *display;
  struct wl_registry *registry;
  struct wl_compositor *compositor;
  struct wl_shm *shm;
  struct zwlr_layer_shell_v1 *layer_shell;

  struct wl_surface *surface;
  struct zwlr_layer_surface_v1 *layer_surface;
  int configured;
  int visible;

  int32_t x;
  int32_t y;
  uint32_t width;
  uint32_t height;

  uint8_t *latest_pixels;
  uint32_t latest_w;
  uint32_t latest_h;
  size_t latest_bytes;

  struct shm_slot slots[2];
  int next_slot;
  int running;
};

static void buffer_release(void *data, struct wl_buffer *wl_buffer) {
  (void)wl_buffer;
  struct shm_slot *slot = data;
  slot->busy = 0;
}

static const struct wl_buffer_listener buffer_listener = {
  .release = buffer_release,
};

static void destroy_slot(struct shm_slot *slot) {
  if (slot->buffer) {
    wl_buffer_destroy(slot->buffer);
    slot->buffer = NULL;
  }
  if (slot->data && slot->data != MAP_FAILED) {
    munmap(slot->data, slot->size);
    slot->data = NULL;
  }
  slot->size = 0;
  slot->width = 0;
  slot->height = 0;
  slot->busy = 0;
}

static struct shm_slot *acquire_slot(struct app_state *st, uint32_t w, uint32_t h) {
  size_t need = (size_t)w * (size_t)h * 4;
  struct shm_slot *slot = &st->slots[st->next_slot];
  if (slot->busy) {
    struct shm_slot *alt = &st->slots[1 - st->next_slot];
    if (!alt->busy) {
      slot = alt;
      st->next_slot = 1 - st->next_slot;
    }
  }
  st->next_slot = 1 - st->next_slot;

  if (slot->buffer && slot->width == w && slot->height == h && slot->size == need) {
    return slot;
  }

  destroy_slot(slot);
  int fd = memfd_create("cs2clean-overlay", MFD_CLOEXEC);
  if (fd < 0) return NULL;
  if (ftruncate(fd, (off_t)need) < 0) {
    close(fd);
    return NULL;
  }
  void *data = mmap(NULL, need, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  if (data == MAP_FAILED) {
    close(fd);
    return NULL;
  }
  struct wl_shm_pool *pool = wl_shm_create_pool(st->shm, fd, (int32_t)need);
  close(fd);
  if (!pool) {
    munmap(data, need);
    return NULL;
  }
  struct wl_buffer *buf = wl_shm_pool_create_buffer(
    pool, 0, (int32_t)w, (int32_t)h, (int32_t)(w * 4), WL_SHM_FORMAT_ARGB8888
  );
  wl_shm_pool_destroy(pool);
  if (!buf) {
    munmap(data, need);
    return NULL;
  }
  wl_buffer_add_listener(buf, &buffer_listener, slot);

  slot->buffer = buf;
  slot->data = data;
  slot->size = need;
  slot->width = w;
  slot->height = h;
  slot->busy = 0;
  return slot;
}

static void commit_latest_frame(struct app_state *st) {
  if (!st->surface || !st->layer_surface || !st->configured || !st->visible) return;
  if (!st->latest_pixels || st->latest_w == 0 || st->latest_h == 0) return;

  struct shm_slot *slot = acquire_slot(st, st->latest_w, st->latest_h);
  if (!slot) return;
  memcpy(slot->data, st->latest_pixels, st->latest_bytes);
  slot->busy = 1;

  int32_t scale = 1;
  if (st->width > 0 && st->latest_w >= st->width && st->latest_w % st->width == 0) {
    scale = (int32_t)(st->latest_w / st->width);
  }
  wl_surface_set_buffer_scale(st->surface, scale);
  wl_surface_attach(st->surface, slot->buffer, 0, 0);
  wl_surface_damage_buffer(st->surface, 0, 0, (int32_t)st->latest_w, (int32_t)st->latest_h);
  wl_surface_commit(st->surface);
  wl_display_flush(st->display);
}

static void layer_surface_configure(
  void *data,
  struct zwlr_layer_surface_v1 *surface,
  uint32_t serial,
  uint32_t width,
  uint32_t height
) {
  (void)width;
  (void)height;
  struct app_state *st = data;
  zwlr_layer_surface_v1_ack_configure(surface, serial);
  st->configured = 1;
  commit_latest_frame(st);
}

static void layer_surface_closed(void *data, struct zwlr_layer_surface_v1 *surface) {
  (void)surface;
  struct app_state *st = data;
  st->configured = 0;
  if (st->layer_surface) {
    zwlr_layer_surface_v1_destroy(st->layer_surface);
    st->layer_surface = NULL;
  }
  if (st->surface) {
    wl_surface_destroy(st->surface);
    st->surface = NULL;
  }
}

static const struct zwlr_layer_surface_v1_listener layer_surface_listener = {
  .configure = layer_surface_configure,
  .closed = layer_surface_closed,
};

static void map_overlay(struct app_state *st) {
  if (st->surface || !st->compositor || !st->layer_shell) return;

  st->surface = wl_compositor_create_surface(st->compositor);
  if (!st->surface) return;

  struct wl_region *empty = wl_compositor_create_region(st->compositor);
  if (empty) {
    wl_surface_set_input_region(st->surface, empty);
    wl_region_destroy(empty);
  }

  st->layer_surface = zwlr_layer_shell_v1_get_layer_surface(
    st->layer_shell,
    st->surface,
    NULL,
    ZWLR_LAYER_SHELL_V1_LAYER_OVERLAY,
    "cs2clean-overlay"
  );
  if (!st->layer_surface) {
    wl_surface_destroy(st->surface);
    st->surface = NULL;
    return;
  }

  st->configured = 0;
  zwlr_layer_surface_v1_set_size(st->layer_surface, st->width, st->height);
  zwlr_layer_surface_v1_set_anchor(
    st->layer_surface,
    ZWLR_LAYER_SURFACE_V1_ANCHOR_TOP | ZWLR_LAYER_SURFACE_V1_ANCHOR_LEFT
  );
  zwlr_layer_surface_v1_set_margin(st->layer_surface, st->y, 0, 0, st->x);
  zwlr_layer_surface_v1_set_exclusive_zone(st->layer_surface, -1);
  zwlr_layer_surface_v1_set_keyboard_interactivity(
    st->layer_surface,
    ZWLR_LAYER_SURFACE_V1_KEYBOARD_INTERACTIVITY_NONE
  );
  zwlr_layer_surface_v1_add_listener(st->layer_surface, &layer_surface_listener, st);

  wl_surface_commit(st->surface);
  wl_display_flush(st->display);
}

static void unmap_overlay(struct app_state *st) {
  st->configured = 0;
  if (st->layer_surface) {
    zwlr_layer_surface_v1_destroy(st->layer_surface);
    st->layer_surface = NULL;
  }
  if (st->surface) {
    wl_surface_destroy(st->surface);
    st->surface = NULL;
  }
  wl_display_flush(st->display);
}

static void registry_global(
  void *data,
  struct wl_registry *registry,
  uint32_t name,
  const char *interface,
  uint32_t version
) {
  (void)version;
  struct app_state *st = data;
  if (strcmp(interface, wl_compositor_interface.name) == 0) {
    st->compositor = wl_registry_bind(registry, name, &wl_compositor_interface, 4);
  } else if (strcmp(interface, wl_shm_interface.name) == 0) {
    st->shm = wl_registry_bind(registry, name, &wl_shm_interface, 1);
  } else if (strcmp(interface, zwlr_layer_shell_v1_interface.name) == 0) {
    uint32_t v = version < 4 ? version : 4;
    st->layer_shell = wl_registry_bind(registry, name, &zwlr_layer_shell_v1_interface, v);
  }
}

static void registry_global_remove(void *data, struct wl_registry *registry, uint32_t name) {
  (void)data;
  (void)registry;
  (void)name;
}

static const struct wl_registry_listener registry_listener = {
  .global = registry_global,
  .global_remove = registry_global_remove,
};

static int read_exact(int fd, void *buf, size_t len) {
  uint8_t *p = buf;
  size_t got = 0;
  while (got < len) {
    ssize_t r = read(fd, p + got, len - got);
    if (r < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    if (r == 0) return 0;
    got += (size_t)r;
  }
  return 1;
}

static int handle_stdin_command(struct app_state *st) {
  uint32_t hdr[3];
  int rc = read_exact(STDIN_FILENO, hdr, sizeof(hdr));
  if (rc <= 0) {
    st->running = 0;
    return 0;
  }

  uint32_t cmd = hdr[0];
  uint32_t w = hdr[1];
  uint32_t h = hdr[2];

  if (cmd == CMD_FRAME) {
    if (w == 0 || h == 0 || w > 8192 || h > 8192) {
      st->running = 0;
      return 0;
    }
    size_t bytes = (size_t)w * (size_t)h * 4;
    if (bytes != st->latest_bytes) {
      uint8_t *next = realloc(st->latest_pixels, bytes);
      if (!next) {
        st->running = 0;
        return 0;
      }
      st->latest_pixels = next;
      st->latest_bytes = bytes;
    }
    st->latest_w = w;
    st->latest_h = h;
    if (read_exact(STDIN_FILENO, st->latest_pixels, bytes) <= 0) {
      st->running = 0;
      return 0;
    }
    commit_latest_frame(st);
  } else if (cmd == CMD_SHOW) {
    st->visible = 1;
    map_overlay(st);
    commit_latest_frame(st);
  } else if (cmd == CMD_HIDE) {
    st->visible = 0;
    unmap_overlay(st);
  } else if (cmd == CMD_QUIT) {
    st->running = 0;
    return 0;
  }
  return 1;
}

int main(int argc, char **argv) {
  struct app_state st;
  memset(&st, 0, sizeof(st));
  st.x = 24;
  st.y = 120;
  st.width = 380;
  st.height = 640;
  st.running = 1;

  for (int i = 1; i + 1 < argc; i += 2) {
    if (strcmp(argv[i], "--x") == 0) st.x = atoi(argv[i + 1]);
    else if (strcmp(argv[i], "--y") == 0) st.y = atoi(argv[i + 1]);
    else if (strcmp(argv[i], "--width") == 0) st.width = (uint32_t)atoi(argv[i + 1]);
    else if (strcmp(argv[i], "--height") == 0) st.height = (uint32_t)atoi(argv[i + 1]);
  }

  st.display = wl_display_connect(NULL);
  if (!st.display) {
    fprintf(stderr, "wayland-overlay: wl_display_connect failed\n");
    return 2;
  }

  st.registry = wl_display_get_registry(st.display);
  wl_registry_add_listener(st.registry, &registry_listener, &st);
  wl_display_roundtrip(st.display);

  if (!st.compositor || !st.shm || !st.layer_shell) {
    fprintf(stderr, "wayland-overlay: missing required Wayland globals (compositor=%p shm=%p layer_shell=%p)\n",
            (void *)st.compositor, (void *)st.shm, (void *)st.layer_shell);
    return 3;
  }

  int wl_fd = wl_display_get_fd(st.display);
  while (st.running) {
    while (wl_display_prepare_read(st.display) != 0) {
      if (wl_display_dispatch_pending(st.display) < 0) {
        st.running = 0;
        break;
      }
    }
    if (!st.running) break;

    if (wl_display_flush(st.display) < 0 && errno != EAGAIN) {
      wl_display_cancel_read(st.display);
      break;
    }

    struct pollfd fds[2];
    fds[0].fd = wl_fd;
    fds[0].events = POLLIN;
    fds[0].revents = 0;
    fds[1].fd = STDIN_FILENO;
    fds[1].events = POLLIN;
    fds[1].revents = 0;

    int ret = poll(fds, 2, -1);
    if (ret < 0) {
      wl_display_cancel_read(st.display);
      if (errno == EINTR) continue;
      break;
    }

    if (fds[0].revents & POLLIN) {
      if (wl_display_read_events(st.display) < 0) break;
      if (wl_display_dispatch_pending(st.display) < 0) break;
    } else {
      wl_display_cancel_read(st.display);
    }

    if (fds[1].revents & (POLLIN | POLLHUP | POLLERR)) {
      if (!handle_stdin_command(&st)) break;
    }
  }

  unmap_overlay(&st);
  destroy_slot(&st.slots[0]);
  destroy_slot(&st.slots[1]);
  free(st.latest_pixels);
  if (st.layer_shell) zwlr_layer_shell_v1_destroy(st.layer_shell);
  if (st.shm) wl_shm_destroy(st.shm);
  if (st.compositor) wl_compositor_destroy(st.compositor);
  if (st.registry) wl_registry_destroy(st.registry);
  wl_display_disconnect(st.display);
  return 0;
}
