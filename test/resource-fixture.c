#define _GNU_SOURCE
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
static void burn(double seconds) {
    struct timespec start, now;
    clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &start);
    do {
        for (volatile int i = 0; i < 10000; ++i) { }
        clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &now);
    } while ((now.tv_sec - start.tv_sec) + (now.tv_nsec - start.tv_nsec) / 1e9 < seconds);
}
int main(int argc, char **argv) {
    if (argc != 2) return 99;
    if (!strcmp(argv[1], "ok")) {
        volatile char *buffer = malloc(8 * 1024 * 1024);
        if (!buffer) return 98;
        for (int i = 0; i < 8 * 1024 * 1024; i += 4096) buffer[i] = 1;
        burn(0.1); free((void *)buffer); return 0;
    }
    if (!strcmp(argv[1], "loop")) { for (;;) burn(1); }
    if (!strcmp(argv[1], "memory") || !strcmp(argv[1], "child-memory")) {
        if (!strcmp(argv[1], "child-memory")) {
            pid_t child = fork();
            if (child < 0) return 90;
            if (child > 0) { for (;;) burn(1); }
        }
        volatile char *buffer = mmap(NULL, 128 * 1024 * 1024, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
        if (buffer == MAP_FAILED) return 97;
        for (int i = 0; i < 128 * 1024 * 1024; i += 4096) buffer[i] = 1;
        return 96;
    }
    if (!strcmp(argv[1], "pids")) {
        int children = 0;
        for (int i = 0; i < 12; ++i) {
            pid_t child = fork();
            if (child == 0) { for (;;) pause(); }
            if (child < 0) return errno == EAGAIN && children == 3 ? 0 : 95;
            ++children;
        }
        return 94;
    }
    if (!strcmp(argv[1], "cpu")) {
        for (int i = 0; i < 2; ++i) {
            pid_t child = fork();
            if (child < 0) return 93;
            if (child == 0) { burn(0.2); return 0; }
        }
        burn(0.2); while (wait(NULL) > 0) { } return 0;
    }
    if (!strcmp(argv[1], "cancel")) { if (fork() < 0) return 92; for (;;) burn(1); }
    return 91;
}
