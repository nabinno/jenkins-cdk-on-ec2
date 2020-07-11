FROM jenkins/jenkins:lts

# Install custom plugins
COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN /usr/local/bin/install-plugins.sh < /usr/share/jenkins/ref/plugins.txt

USER root

RUN apt-get update &&\
        apt-get install -y python-pip &&\
        pip install jinja2 dnspython &&\
        rm -rf /var/lib/apt/lists/*

# Install aws-cli
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" &&\
        unzip awscliv2.zip &&\
        ./aws/install

# # Apply configuration-as-code
# COPY modify_casc.py /modify_casc.py
# COPY config-as-code.j2 /config-as-code.j2
# RUN touch /config-as-code.yaml &&\
#         chown jenkins: /config-as-code.yaml &&\
#         sed -i '/\/bin\/bash*/a \\n\/modify_casc.py' /usr/local/bin/jenkins.sh

# User back to jenkins
USER jenkins
