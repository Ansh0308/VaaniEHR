# A tiny TCP forwarder: `perl fhir-forward.pl <listenPort> <targetPort>` (Perl is in the validator's container image).
# The HL7 validator's server mode listens on 127.0.0.1 INSIDE its container, which Docker cannot publish. This listens on
# 0.0.0.0:<listenPort> in the same container and forwards every connection to 127.0.0.1:<targetPort>. Used only by
# scripts/fhir-validator-server.mjs when the validator runs in Docker (ADR-D40). Nothing is logged or stored.
use strict;
use warnings;
use IO::Socket::INET;
use IO::Select;

my ($listen, $target) = @ARGV;
$SIG{CHLD} = 'IGNORE';
my $server = IO::Socket::INET->new(LocalAddr => '0.0.0.0', LocalPort => $listen, Listen => 50, ReuseAddr => 1)
  or die "cannot listen on $listen: $!";
while (my $client = $server->accept()) {
  my $pid = fork();
  next if !defined $pid;
  if ($pid == 0) {
    close $server;
    my $up = IO::Socket::INET->new(PeerAddr => '127.0.0.1', PeerPort => $target) or exit 1;
    my $sel = IO::Select->new($client, $up);
    my $buf;
    OUTER: while (my @ready = $sel->can_read()) {
      for my $fh (@ready) {
        my $n = sysread($fh, $buf, 65536);
        last OUTER if !$n;
        my $other = $fh == $client ? $up : $client;
        syswrite($other, $buf) // last OUTER;
      }
    }
    exit 0;
  }
  close $client;
}
